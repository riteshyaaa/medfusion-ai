from __future__ import annotations

import csv
import hashlib
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

import numpy as np
import torch
from PIL import Image

from medscope_skin.dataset import load_samples
from medscope_skin.download import download_dataset
from medscope_skin.evaluation import compute_metrics
from medscope_skin.extract import safe_extract, safe_extract_dataset
from medscope_skin.manifest import verify_manifest
from medscope_skin.model import SmallSkinCNN
from medscope_skin.splits import make_splits
from medscope_skin.training import _load_source_manifest, run_training
from medscope_skin.transforms import ImageTransform


LABELS = ["ACK", "BCC", "MEL", "NEV", "SCC", "SEK"]


def _fixture_config() -> dict:
    return {
        "dataset": {
            "id": "SYNTHETIC-TEST-FIXTURE",
            "version": "test-only",
            "doi": "not-a-real-dataset",
            "source_url": "local synthetic fixture",
            "license": "generated test pixels",
            "metadata_filename": "metadata.csv",
            "images_directory": "images",
            "image_column": "img_id",
            "patient_column": "patient_id",
            "lesion_column": "lesion_id",
            "label_column": "diagnostic",
            "label_aliases": {"BOD": "SCC"},
        },
        "data_quality": {
            "exact_hash_conflicts": "exclude-all-samples-from-conflicting-label-groups",
            "same_label_duplicates": "keep-and-merge-for-splitting",
        },
        "task": {"id": "synthetic-six-class-pipeline-test", "labels": LABELS},
        "preprocessing": {
            "version": "synthetic-test-rgb-32-v1",
            "image_size": 32,
            "mean": [0.485, 0.456, 0.406],
            "std": [0.229, 0.224, 0.225],
            "train_horizontal_flip": True,
        },
        "split": {"seed": 20261015, "test_fraction": 0.2, "validation_fraction_of_remaining": 0.2, "group_fields": ["patient_id", "lesion_id", "sha256"]},
        "model": {"architecture": "medscope-small-cnn-v1", "initialization": "random", "pretrained_weights": False},
        "training": {"epochs": 1, "batch_size": 16, "learning_rate": 0.0008, "weight_decay": 0.0001, "early_stopping_patience": 1, "cpu_threads": 1, "num_workers": 0, "class_imbalance": "inverse-frequency-weighted-cross-entropy"},
        "evaluation": {"calibration": "diagnostic-only-raw-softmax", "abstention_score_thresholds": [0.5, 0.8], "subgroup_minimum_support": 3},
    }


def _make_fixture(root: Path) -> Path:
    image_directory = root / "images"
    image_directory.mkdir(parents=True)
    metadata_path = root / "metadata.csv"
    with metadata_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["img_id", "patient_id", "lesion_id", "diagnostic", "gender", "age", "fitspatrick"])
        writer.writeheader()
        for label_index, label in enumerate(LABELS):
            for patient_number in range(12):
                patient_id = f"SYNTHETIC-{label}-{patient_number}"
                lesion_id = f"LESION-{label}-{patient_number}"
                for view_number in range(2):
                    image_id = f"image-{label}-{patient_number}-{view_number}.png"
                    base = np.zeros((32, 32, 3), dtype=np.uint8)
                    base[:, :, label_index % 3] = 40 + label_index * 25 + patient_number
                    base[:, :, (label_index + 1) % 3] = np.arange(32, dtype=np.uint8)[None, :] * 3
                    base[view_number::3, :, :] = np.clip(base[view_number::3, :, :] + 4, 0, 255)
                    Image.fromarray(base).save(image_directory / image_id)
                    writer.writerow({"img_id": image_id, "patient_id": patient_id, "lesion_id": lesion_id, "diagnostic": label, "gender": "synthetic", "age": "40", "fitspatrick": "3"})
    return root


class PipelineTests(unittest.TestCase):
    def test_dataset_labels_and_patient_group_splits(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = _make_fixture(Path(temporary) / "dataset")
            config = _fixture_config()
            samples, summary = load_samples(root, config)
            self.assertEqual(summary["sampleCount"], 144)
            self.assertEqual(summary["patientCount"], 72)
            split = make_splits(samples, LABELS, seed=20261015)
            self.assertEqual(len(split.train) + len(split.validation) + len(split.test), len(samples))
            patient_splits = {}
            lesion_splits = {}
            for name, indices in (("train", split.train), ("validation", split.validation), ("test", split.test)):
                for index in indices:
                    sample = samples[index]
                    patient_splits.setdefault(sample.patient_id, set()).add(name)
                    lesion_splits.setdefault(sample.lesion_id, set()).add(name)
            self.assertTrue(all(len(value) == 1 for value in patient_splits.values()))
            self.assertTrue(all(len(value) == 1 for value in lesion_splits.values()))

    def test_conflicting_exact_duplicate_labels_are_excluded_and_counted(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = _make_fixture(Path(temporary) / "dataset")
            metadata_path = root / "metadata.csv"
            with metadata_path.open("r", encoding="utf-8", newline="") as handle:
                rows = list(csv.DictReader(handle))
            ack = next(row for row in rows if row["diagnostic"] == "ACK")
            bcc = next(row for row in rows if row["diagnostic"] == "BCC")
            ack_image = root / "images" / ack["img_id"]
            bcc_image = root / "images" / bcc["img_id"]
            bcc_image.write_bytes(ack_image.read_bytes())

            samples, summary = load_samples(root, _fixture_config())

            self.assertEqual(len(samples), 142)
            self.assertEqual(summary["sourceSampleCount"], 144)
            self.assertEqual(summary["conflictingDuplicateImageHashGroups"], 1)
            self.assertEqual(summary["excludedConflictingLabelDuplicateSamples"], 2)
            self.assertEqual(summary["classCounts"]["ACK"], 23)
            self.assertEqual(summary["classCounts"]["BCC"], 23)

    def test_eval_preprocessing_is_deterministic_and_model_shape_is_valid(self) -> None:
        transform = ImageTransform(32, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225], training=False)
        image = Image.new("RGB", (40, 24), color=(12, 90, 210))
        first = transform(image)
        second = transform(image)
        self.assertTrue(torch.equal(first, second))
        model = SmallSkinCNN(number_of_classes=len(LABELS))
        self.assertEqual(tuple(model(torch.zeros((2, 3, 32, 32))).shape), (2, len(LABELS)))

    def test_evaluation_reports_per_class_sensitivity_and_specificity(self) -> None:
        labels = np.asarray([0, 0, 1, 1])
        probabilities = np.asarray([[0.9, 0.1], [0.2, 0.8], [0.3, 0.7], [0.8, 0.2]])
        metrics = compute_metrics(labels, probabilities, ["A", "B"], [0.5])
        self.assertEqual(metrics["perClass"]["A"]["sensitivity"], 0.5)
        self.assertEqual(metrics["perClass"]["A"]["specificity"], 0.5)
        self.assertEqual(metrics["perClass"]["B"]["sensitivity"], 0.5)
        self.assertEqual(metrics["perClass"]["B"]["specificity"], 0.5)

    def test_synthetic_training_manifest_and_checksum_gate(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            data_root = _make_fixture(base / "dataset")
            config = _fixture_config()
            source_manifest = {"datasetId": "SYNTHETIC-TEST-FIXTURE", "version": "test-only", "license": "generated test pixels", "archiveSha256": "a" * 64, "downloadedAtUtc": "not-applicable"}
            output = base / "run"
            result = run_training(data_root, config, source_manifest, output)
            manifest_path = output / "manifest.json"
            verified = verify_manifest(manifest_path, config["task"]["id"], LABELS, config["preprocessing"]["version"])
            self.assertEqual(result["status"], "completed_research_run")
            self.assertEqual(result["checkpointSmokeTest"]["status"], "smoke_test_passed")
            self.assertEqual(verified["readinessState"], "research_only_not_approved")
            self.assertTrue((output / "evaluation_report.json").is_file())
            self.assertTrue((output / "reliability.png").is_file())
            with self.assertRaisesRegex(ValueError, "not approved"):
                verify_manifest(manifest_path, config["task"]["id"], LABELS, config["preprocessing"]["version"], require_approved=True)
            with (output / "model.pt").open("ab") as handle:
                handle.write(b"corruption")
            with self.assertRaisesRegex(ValueError, "checksum"):
                verify_manifest(manifest_path, config["task"]["id"], LABELS, config["preprocessing"]["version"])

    def test_download_requires_explicit_license_acknowledgement(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "dataset.zip"
            with self.assertRaisesRegex(ValueError, "--accept-license"):
                download_dataset(destination, accept_license=False)
            self.assertFalse(destination.exists())

    def test_training_requires_matching_dataset_archive_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "PAD-UFES-20-v1.zip"
            archive.write_bytes(b"reviewed research dataset archive fixture")
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            archive_size = archive.stat().st_size
            manifest_path = root / "PAD-UFES-20-v1.zip.manifest.json"
            manifest_path.write_text(json.dumps({
                "datasetId": "PAD-UFES-20",
                "version": "1",
                "license": "CC BY 4.0",
                "archivePath": archive.name,
                "archiveSizeBytes": archive_size,
                "archiveSha256": digest,
                "downloadedAtUtc": "2026-10-15T00:00:00+00:00",
            }), encoding="utf-8")
            self.assertEqual(_load_source_manifest(manifest_path)["archiveSha256"], digest)
            archive.write_bytes(b"x" * archive_size)
            with self.assertRaisesRegex(ValueError, "checksum differs"):
                _load_source_manifest(manifest_path)

    def test_safe_extraction_rejects_path_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            archive = base / "unsafe.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("../outside.txt", "should not extract")
            with self.assertRaisesRegex(ValueError, "unsafe path"):
                safe_extract(archive, base / "extracted")
            self.assertFalse((base / "outside.txt").exists())

    def test_dataset_extraction_expands_nested_image_archives(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            nested_buffer = io.BytesIO()
            with zipfile.ZipFile(nested_buffer, "w") as nested:
                nested.writestr("image-1.png", b"fictional test image bytes")
            archive = base / "dataset.zip"
            with zipfile.ZipFile(archive, "w") as outer:
                outer.writestr("metadata.csv", "img_id\nimage-1.png\n")
                outer.writestr("images/part-1.zip", nested_buffer.getvalue())
            destination = base / "extracted"
            safe_extract_dataset(archive, destination)
            self.assertEqual((destination / "images" / "part-1" / "image-1.png").read_bytes(), b"fictional test image bytes")


if __name__ == "__main__":
    unittest.main()
