from __future__ import annotations

import csv
import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image


@dataclass(frozen=True)
class Sample:
    image_id: str
    image_path: Path
    label: str
    patient_id: str
    lesion_id: str
    sha256: str
    subgroups: dict[str, str]


def _column_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.replace("\ufeff", "").strip().lower()).strip("_")


def _select_column(columns: list[str], configured: str, aliases: tuple[str, ...]) -> str:
    by_key = {_column_key(column): column for column in columns}
    for candidate in (configured, *aliases):
        original = by_key.get(_column_key(candidate))
        if original:
            return original
    raise ValueError(f"Required metadata column is missing: {configured}")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def find_dataset_files(root: Path, metadata_filename: str, images_directory: str) -> tuple[Path, Path]:
    if not root.is_dir():
        raise FileNotFoundError(f"Dataset directory does not exist: {root}")
    metadata_files = [path for path in root.rglob("*") if path.is_file() and path.name.casefold() == metadata_filename.casefold()]
    if len(metadata_files) != 1:
        raise ValueError(f"Expected exactly one {metadata_filename}; found {len(metadata_files)}")
    image_directories = [path for path in root.rglob("*") if path.is_dir() and path.name.casefold() == images_directory.casefold()]
    if len(image_directories) != 1:
        raise ValueError(f"Expected exactly one {images_directory} directory; found {len(image_directories)}")
    return metadata_files[0], image_directories[0]


def load_samples(root: Path, config: dict[str, Any]) -> tuple[list[Sample], dict[str, Any]]:
    dataset_config = config["dataset"]
    quality_policy = config.get("data_quality", {})
    if quality_policy.get("exact_hash_conflicts") != "exclude-all-samples-from-conflicting-label-groups" or quality_policy.get("same_label_duplicates") != "keep-and-merge-for-splitting":
        raise ValueError("Dataset config must explicitly exclude conflicting exact-image labels and group retained exact duplicates.")
    metadata_path, images_path = find_dataset_files(
        root,
        dataset_config["metadata_filename"],
        dataset_config["images_directory"],
    )
    label_order = config["task"]["labels"]
    label_to_index = {label: index for index, label in enumerate(label_order)}
    aliases = {key.upper(): value.upper() for key, value in dataset_config.get("label_aliases", {}).items()}

    image_files = [path for path in images_path.rglob("*") if path.is_file() and path.suffix.lower() in {".png", ".jpg", ".jpeg"}]
    image_index: dict[str, Path] = {}
    for path in image_files:
        for key in (path.name.casefold(), path.stem.casefold()):
            if key in image_index and image_index[key] != path:
                raise ValueError("Image directory contains ambiguous file names.")
            image_index[key] = path

    samples: list[Sample] = []
    seen_image_ids: set[str] = set()
    with metadata_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise ValueError("Metadata CSV has no header.")
        image_column = _select_column(reader.fieldnames, dataset_config["image_column"], ("image_id", "imageid"))
        patient_column = _select_column(reader.fieldnames, dataset_config["patient_column"], ("patient",))
        lesion_column = _select_column(reader.fieldnames, dataset_config["lesion_column"], ("lesion",))
        label_column = _select_column(reader.fieldnames, dataset_config["label_column"], ("diagnosis", "label"))
        subgroup_columns = {
            "sex": next((c for c in reader.fieldnames if _column_key(c) in {"gender", "sex"}), None),
            "age": next((c for c in reader.fieldnames if _column_key(c) == "age"), None),
            "fitzpatrick": next((c for c in reader.fieldnames if _column_key(c) in {"fitspatrick", "fitzpatrick", "skin_type"}), None),
        }
        for row_number, row in enumerate(reader, start=2):
            image_id = (row.get(image_column) or "").strip()
            patient_id = (row.get(patient_column) or "").strip()
            lesion_id = (row.get(lesion_column) or "").strip()
            raw_label = (row.get(label_column) or "").strip().upper()
            if not image_id or not patient_id or not lesion_id or not raw_label:
                raise ValueError(f"Metadata row {row_number} is missing an image, patient, lesion, or diagnosis identifier.")
            if image_id in seen_image_ids:
                raise ValueError("Metadata contains duplicate image identifiers.")
            seen_image_ids.add(image_id)

            label = aliases.get(raw_label, raw_label)
            if label not in label_to_index:
                raise ValueError(f"Metadata contains an unsupported diagnosis label at row {row_number}.")

            basename = Path(image_id).name
            image_path = image_index.get(basename.casefold()) or image_index.get(Path(basename).stem.casefold())
            if image_path is None:
                raise FileNotFoundError(f"Metadata references an image that is not present (row {row_number}).")
            try:
                with Image.open(image_path) as image:
                    image.verify()
            except Exception as error:
                raise ValueError(f"Image decode failed at metadata row {row_number}.") from error

            subgroups: dict[str, str] = {}
            for subgroup, column in subgroup_columns.items():
                if column:
                    value = (row.get(column) or "").strip()
                    if value and value.upper() not in {"UNK", "UNKNOWN", "NAN", "NA"}:
                        subgroups[subgroup] = value
            samples.append(Sample(image_id, image_path, label, patient_id, lesion_id, _sha256(image_path), subgroups))

    if not samples:
        raise ValueError("No labeled images were found in the dataset.")
    by_hash: dict[str, set[str]] = {}
    hash_to_samples: dict[str, list[Sample]] = {}
    for sample in samples:
        by_hash.setdefault(sample.sha256, set()).add(sample.label)
        hash_to_samples.setdefault(sample.sha256, []).append(sample)
    conflicting_duplicate_hashes = sum(len(labels) > 1 for labels in by_hash.values())
    repeated_hashes = sum(len(entries) > 1 for entries in _hash_image_ids(samples).values())
    conflicting_hashes = {digest for digest, labels in by_hash.items() if len(labels) > 1}
    excluded_samples = sum(len(hash_to_samples[digest]) for digest in conflicting_hashes)
    retained_samples = [sample for sample in samples if sample.sha256 not in conflicting_hashes]
    class_counts = {label: sum(sample.label == label for sample in retained_samples) for label in label_order}
    source_class_counts = {label: sum(sample.label == label for sample in samples) for label in label_order}
    if any(count == 0 for count in class_counts.values()):
        raise ValueError("Excluding exact-image groups with conflicting labels removed a configured class.")
    summary = {
        "metadataFile": metadata_path.name,
        "imageDirectory": images_path.name,
        "sourceSampleCount": len(samples),
        "sampleCount": len(retained_samples),
        "sourceClassCounts": source_class_counts,
        "classCounts": class_counts,
        "patientCount": len({sample.patient_id for sample in retained_samples}),
        "lesionCount": len({sample.lesion_id for sample in retained_samples}),
        "uniqueImageHashCount": len(by_hash),
        "duplicateImageHashGroups": repeated_hashes,
        "conflictingDuplicateImageHashGroups": conflicting_duplicate_hashes,
        "excludedConflictingLabelDuplicateSamples": excluded_samples,
        "duplicatePolicy": "exclude-all-samples-in-conflicting-exact-sha256-groups; group-retained-duplicate-hashes-together",
        "subgroupFieldsAvailable": sorted({key for sample in retained_samples for key in sample.subgroups}),
    }
    return retained_samples, summary


def _hash_image_ids(samples: list[Sample]) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    for sample in samples:
        result.setdefault(sample.sha256, []).append(sample.image_id)
    return result
