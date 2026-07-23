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
            "_1.2.0_aarch64.dmg": "limabangbangmang-1.2.0-macos-aarch64.dmg",
            "_aarch64.app.tar.gz": "limabangbangmang-1.2.0-macos-aarch64.app.tar.gz",
            "_1.2.0_amd64.AppImage": "limabangbangmang-1.2.0-linux-x86_64.AppImage",
            "_1.2.0_amd64.deb": "limabangbangmang-1.2.0-linux-x86_64.deb",
            "-1.2.0-1.x86_64.rpm": "limabangbangmang-1.2.0-linux-x86_64.rpm",
            "_1.2.0_x64-setup.exe": "limabangbangmang-1.2.0-windows-x86_64-setup.exe",
            "_1.2.0_x64_zh-TW.msi": "limabangbangmang-1.2.0-windows-x86_64-zh-TW.msi",
        }
        for source, expected in fixtures.items():
            self.assertEqual(normalize.asset_mapping(source, version), expected)

    def test_unrelated_asset_is_ignored(self):
        self.assertIsNone(normalize.asset_mapping("checksums.txt", "1.2.0"))

    def test_v120_canonical_labels(self):
        expected = {
            "limabangbangmang-1.2.0-macos-aarch64.dmg": "立馬幫幫忙 1.2.0 macOS Apple Silicon DMG",
            "limabangbangmang-1.2.0-macos-aarch64.app.tar.gz": "立馬幫幫忙 1.2.0 macOS Apple Silicon App",
            "limabangbangmang-1.2.0-linux-x86_64.AppImage": "立馬幫幫忙 1.2.0 Linux x86_64 AppImage",
            "limabangbangmang-1.2.0-linux-x86_64.deb": "立馬幫幫忙 1.2.0 Linux x86_64 DEB",
            "limabangbangmang-1.2.0-linux-x86_64.rpm": "立馬幫幫忙 1.2.0 Linux x86_64 RPM",
            "limabangbangmang-1.2.0-windows-x86_64-setup.exe": "立馬幫幫忙 1.2.0 Windows x86_64 安裝程式",
            "limabangbangmang-1.2.0-windows-x86_64-zh-TW.msi": "立馬幫幫忙 1.2.0 Windows x86_64 MSI",
        }
        for name, label in expected.items():
            self.assertEqual(normalize.asset_label(name, "1.2.0"), label)

    def test_only_known_malformed_dash_asset_is_cleanup_candidate(self):
        malformed = {"id": 77, "name": "-1.2.0-linux-x86_64.deb", "url": "bad-url"}
        self.assertEqual(
            normalize.malformed_asset_mapping("-1.2.0-linux-x86_64.deb", "1.2.0"),
            "limabangbangmang-1.2.0-linux-x86_64.deb",
        )
        self.assertIsNone(normalize.malformed_asset_mapping("-1.2.0-random.zip", "1.2.0"))
        self.assertEqual(normalize.malformed_cleanup_operations([malformed], "1.2.0"), [
            (malformed, "limabangbangmang-1.2.0-linux-x86_64.deb")
        ])

    def test_partial_retry_keeps_existing_target_and_cleans_old_asset(self):
        old_asset = {"id": 42, "name": "_1.2.0_amd64.deb", "url": "old-url"}
        target_asset = {"id": 84, "name": "limabangbangmang-1.2.0-linux-x86_64.deb", "url": "new-url"}

        operations = normalize.matched_asset_operations([old_asset, target_asset], "1.2.0")

        self.assertEqual(len(operations), 1)
        self.assertIs(operations[0][0], old_asset)
        self.assertEqual(operations[0][1], target_asset["name"])
        self.assertFalse(operations[0][2], "existing target must skip upload but remain a cleanup operation")

    def test_rest_upload_url_percent_encodes_unicode_name(self):
        name = "limabangbangmang-1.2.0-linux-x86_64.deb"
        label = "立馬幫幫忙 1.2.0 Linux x86_64 DEB"
        url = normalize.upload_asset_url("owner/repo", 120, name, label)
        self.assertIn("name=limabangbangmang-1.2.0-linux-x86_64.deb", url)
        self.assertIn("label=%E7%AB%8B%E9%A6%AC%E5%B9%AB%E5%B9%AB%E5%BF%99%201.2.0%20Linux%20x86_64%20DEB", url)
        self.assertNotIn("立馬幫幫忙", url)

    def test_uploaded_asset_requires_exact_name_and_label(self):
        name = "limabangbangmang-1.2.0-linux-x86_64.deb"
        label = "立馬幫幫忙 1.2.0 Linux x86_64 DEB"
        self.assertTrue(normalize.uploaded_asset_matches({"name": name, "label": label}, name, label))
        self.assertFalse(normalize.uploaded_asset_matches({"name": name, "label": "wrong"}, name, label))

    def test_pre_cleanup_guard_requires_draft_release(self):
        normalize.ensure_draft_before_cleanup({"draft": True})
        with self.assertRaisesRegex(RuntimeError, "refusing cleanup"):
            normalize.ensure_draft_before_cleanup({"draft": False})
        with self.assertRaisesRegex(RuntimeError, "refusing cleanup"):
            normalize.ensure_draft_before_cleanup({})


if __name__ == "__main__":
    unittest.main()
