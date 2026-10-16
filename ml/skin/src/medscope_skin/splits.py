from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from sklearn.model_selection import StratifiedGroupKFold

from .dataset import Sample


class _DisjointSet:
    def __init__(self, size: int) -> None:
        self.parent = list(range(size))
        self.rank = [0] * size

    def find(self, item: int) -> int:
        if self.parent[item] != item:
            self.parent[item] = self.find(self.parent[item])
        return self.parent[item]

    def union(self, left: int, right: int) -> None:
        left_root = self.find(left)
        right_root = self.find(right)
        if left_root == right_root:
            return
        if self.rank[left_root] < self.rank[right_root]:
            left_root, right_root = right_root, left_root
        self.parent[right_root] = left_root
        if self.rank[left_root] == self.rank[right_root]:
            self.rank[left_root] += 1


@dataclass(frozen=True)
class DatasetSplit:
    train: tuple[int, ...]
    validation: tuple[int, ...]
    test: tuple[int, ...]
    group_count: int
    manifest_sha256: str


def _leakage_safe_groups(samples: list[Sample]) -> list[str]:
    sets = _DisjointSet(len(samples))
    first_seen: dict[tuple[str, str], int] = {}
    for index, sample in enumerate(samples):
        for kind, value in (("patient", sample.patient_id), ("lesion", sample.lesion_id), ("sha256", sample.sha256)):
            key = (kind, value)
            if key in first_seen:
                sets.union(index, first_seen[key])
            else:
                first_seen[key] = index
    return [f"g{sets.find(index)}" for index in range(len(samples))]


def _fold_score(indices: np.ndarray, labels: np.ndarray, class_count: int, fraction: float) -> float:
    actual = np.bincount(labels[indices], minlength=class_count).astype(np.float64)
    expected = np.bincount(labels, minlength=class_count).astype(np.float64) * fraction
    class_error = np.sum(np.square(actual - expected) / (expected + 1.0))
    size_error = ((len(indices) - len(labels) * fraction) ** 2) / (len(labels) * fraction + 1.0)
    return float(class_error + size_error)


def _best_stratified_group_fold(labels: np.ndarray, groups: np.ndarray, class_count: int, fraction: float, seed: int) -> tuple[np.ndarray, np.ndarray]:
    if len(set(groups.tolist())) < 5:
        raise ValueError("At least five leakage-safe patient groups are required for this split strategy.")
    splitter = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=seed)
    candidates: list[tuple[float, np.ndarray, np.ndarray]] = []
    for train_indices, held_out_indices in splitter.split(np.zeros(len(labels)), labels, groups):
        held_out_counts = np.bincount(labels[held_out_indices], minlength=class_count)
        train_counts = np.bincount(labels[train_indices], minlength=class_count)
        if np.any(held_out_counts == 0) or np.any(train_counts == 0):
            continue
        candidates.append((_fold_score(held_out_indices, labels, class_count, fraction), train_indices, held_out_indices))
    if not candidates:
        raise ValueError("Unable to create group-disjoint splits with every class represented; revise the dataset or split plan.")
    _, train_indices, held_out_indices = min(candidates, key=lambda candidate: candidate[0])
    return train_indices, held_out_indices


def make_splits(samples: list[Sample], label_order: list[str], seed: int, test_fraction: float = 0.2, validation_fraction_of_remaining: float = 0.2) -> DatasetSplit:
    if not 0 < test_fraction < 0.5 or not 0 < validation_fraction_of_remaining < 0.5:
        raise ValueError("Split fractions must be between zero and one half.")
    labels = np.asarray([label_order.index(sample.label) for sample in samples], dtype=np.int64)
    groups = np.asarray(_leakage_safe_groups(samples), dtype=object)
    all_indices = np.arange(len(samples), dtype=np.int64)

    train_validation, test = _best_stratified_group_fold(labels, groups, len(label_order), test_fraction, seed)
    inner_train, validation_local = _best_stratified_group_fold(
        labels[train_validation],
        groups[train_validation],
        len(label_order),
        validation_fraction_of_remaining,
        seed + 1,
    )
    train = train_validation[inner_train]
    validation = train_validation[validation_local]

    split_map = {"train": train, "validation": validation, "test": test}
    for split_name, indices in split_map.items():
        counts = np.bincount(labels[indices], minlength=len(label_order))
        if np.any(counts == 0):
            raise ValueError(f"The {split_name} split is missing at least one configured class.")

    for field in ("patient_id", "lesion_id", "sha256"):
        occupied: dict[str, str] = {}
        for split_name, indices in split_map.items():
            for index in indices:
                value = getattr(samples[int(index)], field)
                owner = occupied.setdefault(value, split_name)
                if owner != split_name:
                    raise ValueError(f"Leakage detected across splits for {field}.")

    split_description: dict[str, list[str]] = {
        name: sorted(samples[int(index)].image_id for index in indices)
        for name, indices in split_map.items()
    }
    encoded = json.dumps(split_description, sort_keys=True, separators=(",", ":")).encode("utf-8")
    split_hash = hashlib.sha256(encoded).hexdigest()
    group_count = len(set(groups.tolist()))
    return DatasetSplit(tuple(map(int, train)), tuple(map(int, validation)), tuple(map(int, test)), group_count, split_hash)


def write_split_manifest(path: Path, samples: list[Sample], split: DatasetSplit, dataset_id: str, version: str, seed: int) -> None:
    contents = {
        "datasetId": dataset_id,
        "datasetVersion": version,
        "seed": seed,
        "groupCount": split.group_count,
        "splitSha256": split.manifest_sha256,
        "splits": {
            "train": sorted(samples[index].image_id for index in split.train),
            "validation": sorted(samples[index].image_id for index in split.validation),
            "test": sorted(samples[index].image_id for index in split.test),
        },
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as handle:
        json.dump(contents, handle, indent=2)
        handle.write("\n")
