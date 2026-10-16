"""Batch-inference entry point for a verified skin checkpoint.

Runs a single image through a manifest-verified checkpoint and prints one JSON
object to stdout. The API server spawns this command; nothing here becomes a
clinical result: the manifest's readiness state is propagated unchanged and the
scores are raw softmax outputs.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import torch
from PIL import Image, UnidentifiedImageError

from .manifest import read_manifest, sha256_file
from .model import SmallSkinCNN
from .transforms import ImageTransform

ALLOWED_READINESS_STATES = {"approved", "research_only_not_approved"}


def _fail(payload: dict[str, Any], code: int) -> int:
    print(json.dumps(payload, indent=2))
    return code


def run_inference(artifact_dir: Path, image_path: Path) -> tuple[dict[str, Any], int]:
    manifest_path = artifact_dir / "manifest.json"
    if not manifest_path.is_file():
        return {"status": "error", "error": "manifest_missing", "message": f"{manifest_path} does not exist"}, 2
    try:
        manifest = read_manifest(manifest_path)
    except ValueError as error:
        return {"status": "error", "error": "manifest_invalid", "message": str(error)}, 2

    if manifest["modality"] != "image":
        return {"status": "error", "error": "incompatible_manifest", "message": "Manifest modality is not an image task."}, 2
    if manifest["readinessState"] not in ALLOWED_READINESS_STATES:
        return {
            "status": "error",
            "error": "readiness_state_not_served",
            "message": f"Manifest readiness state {manifest['readinessState']!r} is not served.",
        }, 2
    if manifest.get("architecture", manifest.get("trainingConfig", {}).get("model", {}).get("architecture")) not in (None, SmallSkinCNN.architecture_id):
        return {
            "status": "error",
            "error": "incompatible_architecture",
            "message": f"Checkpoint architecture {manifest.get('architecture')!r} is not {SmallSkinCNN.architecture_id}.",
        }, 2

    artifact_path = artifact_dir / manifest["artifact"]["path"]
    if not artifact_path.is_file():
        return {"status": "error", "error": "artifact_missing", "message": f"{artifact_path} does not exist."}, 2
    actual_sha = sha256_file(artifact_path)
    if actual_sha != manifest["artifact"]["sha256"]:
        return {"status": "error", "error": "artifact_checksum_mismatch", "message": "Model artifact checksum does not match the manifest."}, 2

    if not image_path.is_file():
        return {"status": "error", "error": "image_missing", "message": f"{image_path} does not exist."}, 2

    labels: list[str] = manifest["labels"]
    if not labels or len(set(labels)) != len(labels):
        return {"status": "error", "error": "invalid_label_map", "message": "Manifest labels must be non-empty and unique."}, 2

    preprocessing = manifest["trainingConfig"]["preprocessing"]
    transform = ImageTransform(
        size=int(preprocessing["image_size"]),
        mean=[float(v) for v in preprocessing["mean"]],
        std=[float(v) for v in preprocessing["std"]],
        training=False,
    )

    try:
        source = Image.open(image_path)
        source.load()
    except (UnidentifiedImageError, OSError) as error:
        return {"status": "error", "error": "image_unreadable", "message": str(error)}, 2

    model = SmallSkinCNN(number_of_classes=len(labels))
    try:
        checkpoint = torch.load(artifact_path, map_location="cpu", weights_only=True)
        state_dict = checkpoint["state_dict"] if isinstance(checkpoint, dict) and "state_dict" in checkpoint else checkpoint
        model.load_state_dict(state_dict, strict=True)
    except Exception as error:  # noqa: BLE001 - surfaced as structured JSON
        return {"status": "error", "error": "checkpoint_load_failed", "message": str(error)}, 2
    model.eval()

    try:
        tensor = transform(source)
    except (OSError, ValueError) as error:
        return {"status": "error", "error": "preprocessing_failed", "message": str(error)}, 2

    if tuple(tensor.shape) != (1, 3, int(preprocessing["image_size"]), int(preprocessing["image_size"])):
        tensor = tensor.unsqueeze(0)
    with torch.inference_mode():
        logits = model(tensor)
    if logits.shape[-1] != len(labels):
        return {"status": "error", "error": "output_dimension_mismatch", "message": f"Model produced {logits.shape[-1]} outputs for {len(labels)} labels."}, 2
    probabilities = torch.softmax(logits, dim=-1)[0].tolist()
    if not all(value == value and 0.0 <= value <= 1.0 for value in probabilities):
        return {"status": "error", "error": "non_finite_output", "message": "Model produced non-finite scores."}, 2

    ranked = sorted(zip(labels, probabilities), key=lambda item: item[1], reverse=True)
    top_label, top_score = ranked[0]
    result = {
        "status": "ok",
        "taskId": manifest["task"],
        "modelId": manifest["modelId"],
        "modelVersion": manifest["modelVersion"],
        "preprocessingVersion": manifest["preprocessingVersion"],
        "readinessState": manifest["readinessState"],
        "calibrationStatus": manifest["calibrationStatus"],
        "scoreSemantics": manifest.get("scoreSemantics", "raw_model_score"),
        "labels": labels,
        "probabilities": {label: score for label, score in zip(labels, probabilities)},
        "topLabel": top_label,
        "topScore": top_score,
        "top2Margin": top_score - ranked[1][1],
        "differentials": [{"disease": label, "confidence": score} for label, score in ranked[1:]],
        "imageSize": list(map(int, source.size)),
        "qualityWarnings": [] if min(source.size) >= int(preprocessing["image_size"]) else ["source_resolution_below_preprocessing_size"],
    }
    return result, 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="medscope-skin infer", description="Run one image through a manifest-verified skin checkpoint.")
    parser.add_argument("--artifact-dir", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    result, code = run_inference(args.artifact_dir, args.image)
    print(json.dumps(result, indent=2))
    return sys.exit(code)
