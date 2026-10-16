from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


REQUIRED_FIELDS = {
    "modelId",
    "modelVersion",
    "modality",
    "task",
    "labels",
    "artifact",
    "framework",
    "preprocessingVersion",
    "datasetProvenance",
    "trainingConfig",
    "evaluationReport",
    "testSetIdentity",
    "calibrationStatus",
    "readinessState",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_manifest(path: Path) -> dict[str, Any]:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or not REQUIRED_FIELDS.issubset(manifest):
        missing = sorted(REQUIRED_FIELDS - set(manifest if isinstance(manifest, dict) else {}))
        raise ValueError(f"Model manifest is incomplete: {', '.join(missing)}")
    return manifest


def verify_manifest(
    path: Path,
    expected_task: str,
    expected_labels: list[str],
    expected_preprocessing: str,
    require_approved: bool = False,
) -> dict[str, Any]:
    manifest = read_manifest(path)
    if manifest["modality"] != "image" or manifest["task"] != expected_task:
        raise ValueError("Model modality or task is incompatible.")
    if manifest["labels"] != expected_labels:
        raise ValueError("Model label map/order is incompatible.")
    if manifest["preprocessingVersion"] != expected_preprocessing:
        raise ValueError("Model preprocessing version is incompatible.")
    if require_approved and manifest["readinessState"] != "approved":
        raise ValueError("Model is not approved for inference.")

    artifact = manifest["artifact"]
    artifact_path_value = artifact.get("path") if isinstance(artifact, dict) else None
    artifact_hash = artifact.get("sha256") if isinstance(artifact, dict) else None
    if not isinstance(artifact_path_value, str) or not isinstance(artifact_hash, str):
        raise ValueError("Model artifact metadata is invalid.")
    artifact_path = (path.parent / artifact_path_value).resolve()
    if not artifact_path.is_relative_to(path.parent.resolve()) or not artifact_path.is_file():
        raise ValueError("Model artifact path is missing or outside the manifest directory.")
    if sha256_file(artifact_path) != artifact_hash:
        raise ValueError("Model artifact checksum does not match its manifest.")
    return manifest

