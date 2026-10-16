from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .dataset import load_samples
from .download import download_dataset, verify_download_manifest
from .extract import safe_extract_dataset
from .manifest import verify_manifest
from .training import _load_source_manifest, run_training, smoke_test_checkpoint


def _load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object in {path}.")
    return value


def _default_config_path() -> Path:
    return Path(__file__).resolve().parents[2] / "configs" / "pad_ufes_v1_baseline.json"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="medscope-skin", description="Research-only skin image dataset and training tools.")
    subcommands = parser.add_subparsers(dest="command", required=True)

    download = subcommands.add_parser("download", help="Download PAD-UFES-20 v1 after reviewing its license.")
    download.add_argument("--output", type=Path, default=Path("data/raw/PAD-UFES-20-v1.zip"))
    download.add_argument("--accept-license", action="store_true")

    extract = subcommands.add_parser("extract", help="Safely extract the downloaded PAD-UFES-20 archive.")
    extract.add_argument("--archive", type=Path, default=Path("data/raw/PAD-UFES-20-v1.zip"))
    extract.add_argument("--manifest", type=Path, default=Path("data/raw/PAD-UFES-20-v1.zip.manifest.json"))
    extract.add_argument("--output", type=Path, default=Path("data/raw/PAD-UFES-20-v1"))

    validate = subcommands.add_parser("validate", help="Validate local image files, labels, and patient/lesion identifiers.")
    validate.add_argument("--data-root", type=Path, default=Path("data/raw/PAD-UFES-20-v1"))
    validate.add_argument("--config", type=Path, default=_default_config_path())

    train = subcommands.add_parser("train", help="Train and evaluate the configured CPU/GPU research baseline.")
    train.add_argument("--data-root", type=Path, default=Path("data/raw/PAD-UFES-20-v1"))
    train.add_argument("--config", type=Path, default=_default_config_path())
    train.add_argument("--source-manifest", type=Path, default=Path("data/raw/PAD-UFES-20-v1.zip.manifest.json"))
    train.add_argument("--output-dir", type=Path)
    train.add_argument("--run-id")

    verify = subcommands.add_parser("verify-manifest", help="Verify model task, class order, preprocessing, readiness, and artifact checksum.")
    verify.add_argument("manifest", type=Path)
    verify.add_argument("--config", type=Path, default=_default_config_path())
    verify.add_argument("--require-approved", action="store_true")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        if args.command == "download":
            result = download_dataset(args.output, args.accept_license)
        elif args.command == "extract":
            verified = verify_download_manifest(args.manifest)
            if verified["archivePath"] != args.archive.name:
                raise ValueError("The extraction archive does not match the reviewed download manifest.")
            safe_extract_dataset(args.archive, args.output)
            result = {"status": "extracted", "destination": str(args.output)}
        elif args.command == "validate":
            config = _load_json(args.config)
            _, summary = load_samples(args.data_root, config)
            result = {"status": "validated", **summary}
        elif args.command == "train":
            config = _load_json(args.config)
            source_manifest = _load_source_manifest(args.source_manifest)
            run_id = args.run_id or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            output_dir = args.output_dir or Path("outputs/ml/skin") / run_id
            result = run_training(args.data_root, config, source_manifest, output_dir)
        else:
            config = _load_json(args.config)
            manifest = verify_manifest(
                args.manifest,
                config["task"]["id"],
                config["task"]["labels"],
                config["preprocessing"]["version"],
                require_approved=args.require_approved,
            )
            checkpoint_smoke_test = smoke_test_checkpoint(
                args.manifest.parent / manifest["artifact"]["path"],
                config["task"]["labels"],
                int(config["preprocessing"]["image_size"]),
            )
            result = {"status": "verified", "modelId": manifest["modelId"], "modelVersion": manifest["modelVersion"], "readinessState": manifest["readinessState"], "artifactSha256": manifest["artifact"]["sha256"], "checkpointSmokeTest": checkpoint_smoke_test}
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        parser.error(str(error))
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
