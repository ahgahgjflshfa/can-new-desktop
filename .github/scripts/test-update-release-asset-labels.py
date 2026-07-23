#!/usr/bin/env python3
import importlib.util
import unittest
from pathlib import Path


path = Path(__file__).with_name("update-release-asset-labels.py")
spec = importlib.util.spec_from_file_location("label_update", path)
if spec is None or spec.loader is None:
    raise RuntimeError("unable to load label update script")
labels = importlib.util.module_from_spec(spec)
spec.loader.exec_module(labels)


class LabelUpdateTests(unittest.TestCase):
    def test_v120_labels(self):
        expected = labels.canonical_labels("1.2.0")
        self.assertEqual(expected["limabangbangmang-1.2.0-windows-x86_64-setup.exe"], "立馬幫幫忙-1.2.0-Windows-x64.exe")
        self.assertEqual(expected["limabangbangmang-1.2.0-windows-x86_64-zh-TW.msi"], "立馬幫幫忙-1.2.0-Windows-x64.msi")
        self.assertEqual(expected["limabangbangmang-1.2.0-macos-aarch64.dmg"], "立馬幫幫忙-1.2.0-macOS-AppleSilicon.dmg")

    def test_patch_is_label_only(self):
        command = labels.patch_label_command("https://api.github.com/repos/o/r/releases/assets/9", "立馬幫幫忙-1.2.0-Linux-x64.deb")
        self.assertIn("PATCH", command)
        self.assertNotIn("DELETE", command)
        self.assertNotIn("POST", command)
        self.assertIn("label=立馬幫幫忙-1.2.0-Linux-x64.deb", command)

    def test_verification_requires_name_unchanged_and_label_exact(self):
        expected = labels.canonical_labels("1.2.0")
        name = "limabangbangmang-1.2.0-linux-x86_64.deb"
        before = [{"id": 1, "name": name, "label": "old", "url": "asset"}]
        after = [{"id": 1, "name": name, "label": expected[name], "url": "asset"}]
        labels.verify_labels(before, after, expected)
        with self.assertRaises(RuntimeError):
            labels.verify_labels(before, [{"id": 1, "name": "renamed", "label": expected[name]}], expected)


if __name__ == "__main__":
    unittest.main()
