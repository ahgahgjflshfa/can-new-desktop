#!/usr/bin/env python3
import importlib.util
import unittest
from pathlib import Path


path = Path(__file__).with_name("normalize-release-assets.py")
spec = importlib.util.spec_from_file_location("normalize", path)
if spec is None or spec.loader is None:
    raise RuntimeError("unable to load normalization script")
normalize = importlib.util.module_from_spec(spec)
spec.loader.exec_module(normalize)


class AssetMappingTests(unittest.TestCase):
    def test_draft_lookup_uses_release_list_and_numeric_id(self):
        releases = [
            [{"id": 7, "tag_name": "v1.1.0", "draft": True}],
            [{"id": 120, "tag_name": "v1.2.0", "draft": True}],
        ]

        release = normalize.find_release_by_tag(releases, "v1.2.0")

        self.assertEqual(release, {"id": 120, "tag_name": "v1.2.0", "draft": True})
        self.assertEqual(normalize.release_endpoint("owner/repo", release["id"]), "repos/owner/repo/releases/120")

    def test_v120_default_tauri_assets(self):
        version = "1.2.0"
        fixtures = {
            "_1.2.0_aarch64.dmg": "立馬幫幫忙-1.2.0-macos-aarch64.dmg",
            "_aarch64.app.tar.gz": "立馬幫幫忙-1.2.0-macos-aarch64.app.tar.gz",
            "_1.2.0_amd64.AppImage": "立馬幫幫忙-1.2.0-linux-x86_64.AppImage",
            "_1.2.0_amd64.deb": "立馬幫幫忙-1.2.0-linux-x86_64.deb",
            "-1.2.0-1.x86_64.rpm": "立馬幫幫忙-1.2.0-linux-x86_64.rpm",
            "_1.2.0_x64-setup.exe": "立馬幫幫忙-1.2.0-windows-x86_64-setup.exe",
            "_1.2.0_x64_zh-TW.msi": "立馬幫幫忙-1.2.0-windows-x86_64-zh-TW.msi",
        }
        for source, expected in fixtures.items():
            self.assertEqual(normalize.asset_mapping(source, version), expected)

    def test_unrelated_asset_is_ignored(self):
        self.assertIsNone(normalize.asset_mapping("checksums.txt", "1.2.0"))

    def test_partial_retry_keeps_existing_target_and_cleans_old_asset(self):
        old_asset = {"id": 42, "name": "_1.2.0_amd64.deb", "url": "old-url"}
        target_asset = {"id": 84, "name": "立馬幫幫忙-1.2.0-linux-x86_64.deb", "url": "new-url"}

        operations = normalize.matched_asset_operations([old_asset, target_asset], "1.2.0")

        self.assertEqual(len(operations), 1)
        self.assertIs(operations[0][0], old_asset)
        self.assertEqual(operations[0][1], target_asset["name"])
        self.assertFalse(operations[0][2], "existing target must skip upload but remain a cleanup operation")

    def test_new_upload_does_not_clobber(self):
        command = normalize.upload_command("v1.2.0", "owner/repo", Path("asset.deb"))
        self.assertNotIn("--clobber", command)


if __name__ == "__main__":
    unittest.main()
