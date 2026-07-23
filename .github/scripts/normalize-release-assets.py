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
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import quote


PRODUCT = "limabangbangmang"
LABEL_PRODUCT = "立馬幫幫忙"


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


def asset_label(name: str, version: str) -> str | None:
    labels = {
        f"{PRODUCT}-{version}-macos-aarch64.dmg": f"{LABEL_PRODUCT} {version} macOS Apple Silicon DMG",
        f"{PRODUCT}-{version}-macos-aarch64.app.tar.gz": f"{LABEL_PRODUCT} {version} macOS Apple Silicon App",
        f"{PRODUCT}-{version}-linux-x86_64.AppImage": f"{LABEL_PRODUCT} {version} Linux x86_64 AppImage",
        f"{PRODUCT}-{version}-linux-x86_64.deb": f"{LABEL_PRODUCT} {version} Linux x86_64 DEB",
        f"{PRODUCT}-{version}-linux-x86_64.rpm": f"{LABEL_PRODUCT} {version} Linux x86_64 RPM",
        f"{PRODUCT}-{version}-windows-x86_64-setup.exe": f"{LABEL_PRODUCT} {version} Windows x86_64 安裝程式",
        f"{PRODUCT}-{version}-windows-x86_64-zh-TW.msi": f"{LABEL_PRODUCT} {version} Windows x86_64 MSI",
    }
    return labels.get(name)


def malformed_asset_mapping(name: str, version: str) -> str | None:
    """Map only the dash-prefixed names produced by the failed gh upload run."""
    targets = (
        f"{PRODUCT}-{version}-macos-aarch64.dmg",
        f"{PRODUCT}-{version}-macos-aarch64.app.tar.gz",
        f"{PRODUCT}-{version}-linux-x86_64.AppImage",
        f"{PRODUCT}-{version}-linux-x86_64.deb",
        f"{PRODUCT}-{version}-linux-x86_64.rpm",
        f"{PRODUCT}-{version}-windows-x86_64-setup.exe",
        f"{PRODUCT}-{version}-windows-x86_64-zh-TW.msi",
    )
    for target in targets:
        if name == target.removeprefix(PRODUCT):
            return target
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


def upload_asset_url(repo: str, release_id: int, name: str, label: str) -> str:
    return (
        f"https://uploads.github.com/repos/{repo}/releases/{release_id}/assets"
        f"?name={quote(name, safe='')}&label={quote(label, safe='')}"
    )


def upload_asset(token: str, repo: str, release_id: int, name: str, label: str, path: Path) -> None:
    """Upload through REST so Unicode in the asset name is never shell-parsed."""
    request = urllib.request.Request(
        upload_asset_url(repo, release_id, name, label),
        data=path.read_bytes(),
        method="POST",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/octet-stream",
        },
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        uploaded = json.loads(response.read())
    if not uploaded_asset_matches(uploaded, name, label):
        raise RuntimeError(
            f"GitHub returned unexpected uploaded asset metadata: "
            f"name={uploaded.get('name')!r}, label={uploaded.get('label')!r}"
        )


def uploaded_asset_matches(asset: dict, name: str, label: str) -> bool:
    return asset.get("name") == name and asset.get("label") == label


def ensure_draft_before_cleanup(release: dict) -> None:
    if release.get("draft") is not True:
        raise RuntimeError("release is no longer a draft; refusing cleanup")


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


def malformed_cleanup_operations(assets: list[dict], version: str) -> list[tuple[dict, str]]:
    """Return cleanup candidates restricted to the seven known failed names."""
    return [
        (asset, target)
        for asset in assets
        if (target := malformed_asset_mapping(asset["name"], version)) is not None
    ]


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
    by_name = {asset["name"]: asset for asset in assets}
    malformed_cleanup = malformed_cleanup_operations(assets, version)
    operation_targets = {new_name for _, new_name, _ in operations}
    for asset, target in malformed_cleanup:
        if target not in by_name and target not in operation_targets:
            operations.append((asset, target, True))
            operation_targets.add(target)
        else:
            print(f"retain malformed cleanup for {asset['name']}: {target}")

    if not operations and not malformed_cleanup:
        print("No Tauri default assets require normalization.")
        return 0
    for asset, new_name, needs_upload in operations:
        label = asset_label(new_name, version)
        if label is None:
            raise RuntimeError(f"no label mapping for canonical asset {new_name}")
        print(f"{asset['name']} -> {new_name} (label: {label})")
    if args.dry_run:
        return 0

    # Everything is downloaded before any upload. Old asset IDs are deleted only
    # after every replacement has uploaded and been observed in the release.
    with tempfile.TemporaryDirectory(prefix="release-assets-") as directory:
        files: list[tuple[dict, str, str, Path]] = []
        for asset, new_name, needs_upload in operations:
            if not needs_upload:
                continue
            destination = Path(directory) / new_name
            run_gh(
                ["api", "-H", "Accept: application/octet-stream", asset["url"]],
                output_file=destination,
            )
            label = asset_label(new_name, version)
            if label is None:
                raise RuntimeError(f"no label mapping for canonical asset {new_name}")
            files.append((asset, new_name, label, destination))

        token = os.environ.get("GH_TOKEN")
        if files:
            if token is None:
                raise RuntimeError("GH_TOKEN is required for REST asset upload")
            for _, new_name, label, path in files:
                upload_asset(token, args.repo, release["id"], new_name, label, path)

        refreshed = json.loads(run_gh(["api", release_api_endpoint]))
        refreshed_by_name = {asset["name"]: asset for asset in refreshed.get("assets", [])}
        required_targets = operation_targets | {target for _, target in malformed_cleanup}
        missing = [
            target
            for target in required_targets
            if target not in refreshed_by_name
            or not uploaded_asset_matches(refreshed_by_name[target], target, asset_label(target, version) or "")
        ]
        if missing:
            raise RuntimeError("upload verification failed; old assets were left untouched: " + ", ".join(missing))
        ensure_draft_before_cleanup(refreshed)

        cleanup_assets = {asset["id"]: asset for asset, _, _ in operations}
        cleanup_assets.update({asset["id"]: asset for asset, _ in malformed_cleanup})
        for asset in cleanup_assets.values():
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
