from __future__ import annotations

import argparse
import stat
import zipfile
from pathlib import Path, PurePosixPath

from .download import verify_download_manifest


MAX_EXTRACTED_BYTES = 12 * 1024 * 1024 * 1024


def _preflight_archive(archive: Path, destination: Path) -> tuple[list[tuple[zipfile.ZipInfo, Path]], int]:
    if not zipfile.is_zipfile(archive):
        raise ValueError("The supplied dataset archive is not a valid ZIP file.")
    if destination.exists() and any(destination.iterdir()):
        raise FileExistsError(f"Refusing to extract into a non-empty directory: {destination}")

    with zipfile.ZipFile(archive) as bundle:
        members = bundle.infolist()
        total_uncompressed = sum(member.file_size for member in members)
        if total_uncompressed > MAX_EXTRACTED_BYTES:
            raise ValueError("Dataset archive exceeds the configured 12 GiB extraction limit.")

        root = destination.resolve()
        checked: list[tuple[zipfile.ZipInfo, Path]] = []
        for member in members:
            relative = PurePosixPath(member.filename)
            if relative.is_absolute() or ".." in relative.parts or not relative.parts:
                raise ValueError("Dataset archive contains an unsafe path.")
            target = (destination / Path(*relative.parts)).resolve()
            if not target.is_relative_to(root):
                raise ValueError("Dataset archive contains a path outside the extraction directory.")
            mode = member.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise ValueError("Dataset archive contains a symbolic link.")
            checked.append((member, target))
    return checked, total_uncompressed


def safe_extract(archive: Path, destination: Path) -> None:
    checked, _ = _preflight_archive(archive, destination)
    destination_root = destination.resolve()

    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as bundle:
        for member, target in checked:
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.resolve().is_relative_to(destination_root):
                raise ValueError("Dataset archive contains a path outside the extraction directory.")
            with bundle.open(member) as source, target.open("xb") as output:
                while chunk := source.read(1024 * 1024):
                    output.write(chunk)


def extract_nested_image_archives(destination: Path) -> None:
    image_directories = [path for path in destination.rglob("*") if path.is_dir() and path.name.casefold() == "images"]
    if len(image_directories) != 1:
        raise ValueError(f"Expected exactly one images directory in PAD-UFES-20; found {len(image_directories)}.")
    image_directory = image_directories[0]
    nested_archives = sorted(path for path in image_directory.glob("*.zip") if path.is_file())
    if not nested_archives:
        raise ValueError("The PAD-UFES-20 release contains no nested image archives.")

    preflighted: list[tuple[Path, Path]] = []
    total_uncompressed = 0
    for nested_archive in nested_archives:
        nested_destination = image_directory / nested_archive.stem
        _, uncompressed_size = _preflight_archive(nested_archive, nested_destination)
        total_uncompressed += uncompressed_size
        if total_uncompressed > MAX_EXTRACTED_BYTES:
            raise ValueError("Nested image archives exceed the configured 12 GiB combined extraction limit.")
        preflighted.append((nested_archive, nested_destination))
    for nested_archive, nested_destination in preflighted:
        safe_extract(nested_archive, nested_destination)


def safe_extract_dataset(archive: Path, destination: Path) -> None:
    if not (destination.exists() and any(destination.iterdir())):
        safe_extract(archive, destination)
    else:
        metadata_files = [path for path in destination.rglob("metadata.csv") if path.is_file()]
        image_directories = [path for path in destination.rglob("*") if path.is_dir() and path.name.casefold() == "images"]
        if len(metadata_files) != 1 or len(image_directories) != 1:
            raise FileExistsError(f"Refusing to reuse a non-empty directory that is not an extracted PAD-UFES-20 release: {destination}")
    extract_nested_image_archives(destination)


def main() -> int:
    parser = argparse.ArgumentParser(description="Safely extract PAD-UFES-20 v1 into an empty local directory.")
    parser.add_argument("--archive", type=Path, default=Path("data/raw/PAD-UFES-20-v1.zip"))
    parser.add_argument("--manifest", type=Path, default=Path("data/raw/PAD-UFES-20-v1.zip.manifest.json"))
    parser.add_argument("--output", type=Path, default=Path("data/raw/PAD-UFES-20-v1"))
    args = parser.parse_args()
    try:
        verified = verify_download_manifest(args.manifest)
        if verified["archivePath"] != args.archive.name:
            raise ValueError("The extraction archive does not match the reviewed download manifest.")
        safe_extract_dataset(args.archive, args.output)
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        parser.error(str(error))
    print(f"Extracted the verified dataset archive into {args.output}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
