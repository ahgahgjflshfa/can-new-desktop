#!/usr/bin/env python3
"""Rename the Tauri default release assets without publishing the release."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


PRODUCT = "立馬幫幫忙"


def asset_mapping(name: str, version: str) -> str | None:
    """Return the canonical name for a supported Tauri default asset."""
    prefix = re.escape(version)
    patterns = (
        (rf"_{prefix}_aarch64\.dmg", f"{PRODUCT}-{version}-macos-aarch64.dmg"),
        (r"_aarch64\.app\.tar\.gz", f"{PRODUCT}-{version}-macos-aarch64.app.tar.gz"),
        (rf"_{prefix}_amd64\.AppImage", f"{PRODUCT}-{version}-linux-x86_64.AppImage"),
        (rf"_{prefix}_amd64\.deb", f"{PRODUCT}-{version}-linux-x86_64.deb"),
        (rf"-{prefix}-1\.x86_64\.rpm", f"{PRODUCT}-{version}-linux-x86_64.rpm"),
        (rf"_{prefix}_x64-setup\.exe", f"{PRODUCT}-{version}-windows-x86_64-setup.exe"),
        (rf"_{prefix}_x64_zh-TW\.msi", f"{PRODUCT}-{version}-windows-x86_64-zh-TW.msi"),
    )
    for pattern, canonical in patterns:
        if re.fullmatch(pattern, name):
            return canonical
    return None


def run_gh(args: list[str], *, output_file: Path | None = None) -> str:
    command = ["gh", *args]
    if output_file is None:
        return subprocess.run(command, check=True, text=True, capture_output=True).stdout
    with output_file.open("wb") as stream:
        subprocess.run(command, check=True, stdout=stream)
    return ""


def find_release_by_tag(releases: list[Any], tag: str) -> dict | None:
    """Find a release in one or more authenticated, paginated API pages."""
    candidates: list[dict] = (
        [release for page in releases for release in page]
        if releases and isinstance(releases[0], list)
        else releases
    )
    return next((release for release in candidates if release.get("tag_name") == tag), None)


def upload_command(tag: str, repo: str, path: Path) -> list[str]:
    """Build an upload command without clobbering a concurrent canonical asset."""
    return ["release", "upload", tag, str(path), "--repo", repo]


def release_endpoint(repo: str, release_id: int) -> str:
    return f"repos/{repo}/releases/{release_id}"


def matched_asset_operations(assets: list[dict], version: str) -> list[tuple[dict, str, bool]]:
    """Return matched old assets and whether each still needs uploading."""
    by_name = {asset["name"] for asset in assets}
    operations = []
    for asset in assets:
        old_name = asset["name"]
        if old_name.startswith(f"{PRODUCT}-"):
            print(f"skip already canonical: {old_name}")
            continue
        new_name = asset_mapping(old_name, version)
        if new_name is None:
            continue
        needs_upload = new_name not in by_name
        if not needs_upload:
            print(f"retain cleanup for {old_name}: {new_name} already exists")
        operations.append((asset, new_name, needs_upload))
    return operations


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", required=True, help="Release tag, for example v1.2.0")
    parser.add_argument("--repo", default=os.environ.get("GH_REPO"))
    parser.add_argument("--dry-run", action="store_true", help="List actions without downloading/uploading/deleting")
    args = parser.parse_args()

    if not args.repo:
        args.repo = run_gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).strip()
    if not re.fullmatch(r"v?\d+\.\d+\.\d+", args.tag):
        parser.error("--tag must look like v1.2.0")
    version = args.tag.removeprefix("v")
    releases_endpoint = f"repos/{args.repo}/releases?per_page=100"
    release_pages = json.loads(run_gh(["api", "--paginate", "--slurp", releases_endpoint]))
    release = find_release_by_tag(release_pages, args.tag)
    if release is None:
        raise RuntimeError(f"release {args.tag} was not found in authenticated releases")
    if not release.get("draft"):
        raise RuntimeError(f"release {args.tag} is not a draft; refusing to change it")
    release_api_endpoint = release_endpoint(args.repo, release["id"])
    release = json.loads(run_gh(["api", release_api_endpoint]))
    if not release.get("draft"):
        raise RuntimeError(f"release {args.tag} is not a draft; refusing to change it")

    assets = release.get("assets", [])
    operations = matched_asset_operations(assets, version)

    if not operations:
        print("No Tauri default assets require normalization.")
        return 0
    for asset, new_name, needs_upload in operations:
        print(f"{asset['name']} -> {new_name}")
    if args.dry_run:
        return 0

    # Everything is downloaded before any upload. Old asset IDs are deleted only
    # after every replacement has uploaded and been observed in the release.
    with tempfile.TemporaryDirectory(prefix="release-assets-") as directory:
        files: list[tuple[dict, str, Path]] = []
        for asset, new_name, needs_upload in operations:
            if not needs_upload:
                continue
            destination = Path(directory) / new_name
            run_gh(
                ["api", "-H", "Accept: application/octet-stream", asset["url"]],
                output_file=destination,
            )
            files.append((asset, new_name, destination))

        for _, new_name, path in files:
            run_gh(upload_command(args.tag, args.repo, path))

        refreshed = json.loads(run_gh(["api", release_api_endpoint]))
        refreshed_names = {asset["name"] for asset in refreshed.get("assets", [])}
        missing = [new_name for _, new_name, _ in operations if new_name not in refreshed_names]
        if missing:
            raise RuntimeError("upload verification failed; old assets were left untouched: " + ", ".join(missing))

        for asset, _, _ in operations:
            run_gh(["api", "--method", "DELETE", asset["url"]])
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as error:
        print(f"gh command failed (exit {error.returncode}); old assets were left untouched", file=sys.stderr)
        raise
    except Exception as error:
        print(f"{error}; old assets were left untouched", file=sys.stderr)
        raise
