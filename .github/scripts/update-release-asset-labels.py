#!/usr/bin/env python3
"""Update labels of the seven canonical release assets without changing files."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from typing import Any


PRODUCT = "limabangbangmang"
LABEL_PRODUCT = "立馬幫幫忙"


def canonical_labels(version: str) -> dict[str, str]:
    return {
        f"{PRODUCT}-{version}-macos-aarch64.dmg": f"{LABEL_PRODUCT}-{version}-macOS-AppleSilicon.dmg",
        f"{PRODUCT}-{version}-macos-aarch64.app.tar.gz": f"{LABEL_PRODUCT}-{version}-macOS-AppleSilicon.app.tar.gz",
        f"{PRODUCT}-{version}-linux-x86_64.AppImage": f"{LABEL_PRODUCT}-{version}-Linux-x64.AppImage",
        f"{PRODUCT}-{version}-linux-x86_64.deb": f"{LABEL_PRODUCT}-{version}-Linux-x64.deb",
        f"{PRODUCT}-{version}-linux-x86_64.rpm": f"{LABEL_PRODUCT}-{version}-Linux-x64.rpm",
        f"{PRODUCT}-{version}-windows-x86_64-setup.exe": f"{LABEL_PRODUCT}-{version}-Windows-x64.exe",
        f"{PRODUCT}-{version}-windows-x86_64-zh-TW.msi": f"{LABEL_PRODUCT}-{version}-Windows-x64.msi",
    }


def run_gh(args: list[str]) -> str:
    return subprocess.run(["gh", *args], check=True, text=True, capture_output=True).stdout


def find_release_by_tag(releases: list[Any], tag: str) -> dict | None:
    candidates = (
        [release for page in releases for release in page]
        if releases and isinstance(releases[0], list)
        else releases
    )
    return next((release for release in candidates if release.get("tag_name") == tag), None)


def release_endpoint(repo: str, release_id: int) -> str:
    return f"repos/{repo}/releases/{release_id}"


def patch_label_command(asset_url: str, label: str) -> list[str]:
    return ["api", "--method", "PATCH", asset_url, "-f", f"label={label}"]


def verify_labels(before_assets: list[dict], after_assets: list[dict], expected: dict[str, str]) -> None:
    before = {asset["id"]: asset["name"] for asset in before_assets if asset["name"] in expected}
    after = {asset["id"]: asset for asset in after_assets if asset["id"] in before}
    if set(after) != set(before):
        raise RuntimeError("release asset IDs changed during label update")
    for asset_id, name in before.items():
        asset = after[asset_id]
        if asset["name"] != name or asset.get("label") != expected[name]:
            raise RuntimeError(
                f"asset verification failed for {name}: "
                f"name={asset.get('name')!r}, label={asset.get('label')!r}"
            )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", required=True, help="Release tag, for example v1.2.0")
    parser.add_argument("--repo", default=os.environ.get("GH_REPO"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not re.fullmatch(r"v?\d+\.\d+\.\d+", args.tag):
        parser.error("--tag must look like v1.2.0")
    if not args.repo:
        args.repo = run_gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).strip()
    version = args.tag.removeprefix("v")
    releases = json.loads(run_gh(["api", "--paginate", "--slurp", f"repos/{args.repo}/releases?per_page=100"]))
    release = find_release_by_tag(releases, args.tag)
    if release is None:
        raise RuntimeError(f"release {args.tag} was not found")
    endpoint = release_endpoint(args.repo, release["id"])
    current = json.loads(run_gh(["api", endpoint]))
    expected = canonical_labels(version)
    assets = current.get("assets", [])
    by_name = {asset["name"]: asset for asset in assets}
    missing = sorted(set(expected) - set(by_name))
    if missing:
        raise RuntimeError("release is missing canonical assets: " + ", ".join(missing))

    for name, label in expected.items():
        print(f"{name}: label -> {label}")
    if args.dry_run:
        return 0

    for name, label in expected.items():
        run_gh(patch_label_command(by_name[name]["url"], label))

    refreshed = json.loads(run_gh(["api", endpoint]))
    verify_labels(assets, refreshed.get("assets", []), expected)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
