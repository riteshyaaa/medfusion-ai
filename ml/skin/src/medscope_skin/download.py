from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DATASET_ID = "PAD-UFES-20"
DATASET_VERSION = "1"
DATASET_URL = "https://data.mendeley.com/public-api/zip/zr7vgbcyr2/download/1"
DATASET_DOI = "10.17632/zr7vgbcyr2.1"
MAX_ARCHIVE_BYTES = 8 * 1024 * 1024 * 1024


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_download_manifest(path: Path) -> dict[str, object]:
    if not path.is_file():
        raise FileNotFoundError("Dataset download manifest is required to use this archive.")
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise ValueError("Dataset download manifest must contain a JSON object.")
    if manifest.get("datasetId") != DATASET_ID or manifest.get("version") != DATASET_VERSION or manifest.get("license") != "CC BY 4.0":
        raise ValueError("Dataset download manifest does not identify the reviewed PAD-UFES-20 v1 source.")
    archive_hash = manifest.get("archiveSha256")
    archive_name = manifest.get("archivePath")
    archive_size = manifest.get("archiveSizeBytes")
    downloaded_at = manifest.get("downloadedAtUtc")
    if not isinstance(archive_hash, str) or not re.fullmatch(r"[a-f0-9]{64}", archive_hash):
        raise ValueError("Dataset archive checksum is missing or invalid in the download manifest.")
    if not isinstance(archive_name, str) or not archive_name or Path(archive_name).name != archive_name:
        raise ValueError("Dataset archive path must be a local file name in the download manifest.")
    if not isinstance(archive_size, int) or isinstance(archive_size, bool) or archive_size <= 0 or not isinstance(downloaded_at, str):
        raise ValueError("Dataset archive size or download timestamp is missing from the download manifest.")
    archive_path = path.parent / archive_name
    if not archive_path.is_file() or archive_path.stat().st_size != archive_size:
        raise ValueError("The local dataset archive is missing or its size differs from the download manifest.")
    if sha256_file(archive_path) != archive_hash:
        raise ValueError("The local dataset archive checksum differs from the download manifest.")
    return manifest


def download_dataset(destination: Path, accept_license: bool) -> dict[str, object]:
    if not accept_license:
        raise ValueError("Pass --accept-license after reviewing the CC BY 4.0 terms and dataset provenance.")
    if destination.exists():
        raise FileExistsError(f"Refusing to overwrite existing file: {destination}")
    manifest_path = destination.with_suffix(destination.suffix + ".manifest.json")
    if manifest_path.exists():
        raise FileExistsError(f"Refusing to overwrite existing manifest: {manifest_path}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".part")
    if temporary.exists():
        raise FileExistsError(f"Refusing to overwrite existing partial download: {temporary}")
    request = Request(DATASET_URL, headers={"User-Agent": "MedScope-AI-research/0.1"})
    digest = hashlib.sha256()
    downloaded = 0
    temporary_created = False
    try:
        with urlopen(request, timeout=60) as response:
            content_length = response.headers.get("Content-Length")
            if content_length and int(content_length) > MAX_ARCHIVE_BYTES:
                raise ValueError("Dataset archive exceeds the configured 8 GiB safety limit.")
            with temporary.open("xb") as output:
                temporary_created = True
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    downloaded += len(chunk)
                    if downloaded > MAX_ARCHIVE_BYTES:
                        raise ValueError("Dataset archive exceeded the configured 8 GiB safety limit.")
                    digest.update(chunk)
                    output.write(chunk)
                    if downloaded and downloaded % (64 * 1024 * 1024) < len(chunk):
                        print(f"Downloaded {downloaded // (1024 * 1024)} MiB", file=sys.stderr)
                output.flush()
                os.fsync(output.fileno())
        if downloaded == 0:
            raise ValueError("The dataset host returned an empty archive.")
        os.replace(temporary, destination)
    except (HTTPError, URLError, TimeoutError, OSError, ValueError):
        if temporary_created:
            temporary.unlink(missing_ok=True)
        raise

    manifest: dict[str, object] = {
        "datasetId": DATASET_ID,
        "version": DATASET_VERSION,
        "doi": DATASET_DOI,
        "sourceUrl": "https://data.mendeley.com/datasets/zr7vgbcyr2/1",
        "downloadUrl": DATASET_URL,
        "license": "CC BY 4.0",
        "downloadedAtUtc": datetime.now(timezone.utc).isoformat(),
        "archivePath": destination.name,
        "archiveSizeBytes": downloaded,
        "archiveSha256": digest.hexdigest(),
        "redistributed": False,
    }
    with manifest_path.open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Download the public PAD-UFES-20 v1 archive after license review.")
    parser.add_argument("--output", type=Path, default=Path("data/raw/PAD-UFES-20-v1.zip"))
    parser.add_argument("--accept-license", action="store_true", help="Acknowledge CC BY 4.0 and the documented dataset provenance.")
    args = parser.parse_args()
    try:
        manifest = download_dataset(args.output, args.accept_license)
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps({"status": "downloaded", "datasetId": manifest["datasetId"], "version": manifest["version"], "archiveSizeBytes": manifest["archiveSizeBytes"], "archiveSha256": manifest["archiveSha256"], "manifestPath": str(args.output.with_suffix(args.output.suffix + ".manifest.json"))}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
