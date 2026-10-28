"""PID persistence must never modify the signed application bundle."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from src import config, ollama_manager


class OllamaPidPathTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ollama-pid-", dir=os.environ["TMPDIR"])
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.user_dir = self.root / "new" / "user-data"
        self.bundle = self.root / "Dummy.app" / "Contents" / "Resources" / "stenoai" / "_internal"
        self.bundle.mkdir(parents=True)
        (self.bundle / "signed-resource").write_bytes(b"unchanged")
        self.env = patch.dict(os.environ, {"STENOAI_USER_DATA_DIR": str(self.user_dir)})
        self.env.start()
        self.addCleanup(self.env.stop)

    def snapshot_bundle(self):
        return {str(p.relative_to(self.bundle)): p.read_bytes() for p in self.bundle.rglob("*") if p.is_file()}

    def test_frozen_write_creates_user_parent_without_touching_bundle(self):
        before = self.snapshot_bundle()
        with patch.object(sys, "frozen", True, create=True), patch.object(sys, "_MEIPASS", str(self.bundle), create=True):
            self.assertFalse(self.user_dir.exists())
            ollama_manager._write_pid(424242)
            self.assertEqual(self.snapshot_bundle(), before)
            self.assertEqual(ollama_manager._get_pid_file(), self.user_dir / "ollama.pid")
            self.assertEqual((self.user_dir / "ollama.pid").read_text(), "424242")

    def test_source_mode_honors_explicit_user_directory(self):
        with patch.object(sys, "frozen", False, create=True):
            self.assertEqual(ollama_manager._get_pid_file(), self.user_dir / "ollama.pid")

    def test_default_user_root_is_shared_with_electron_even_in_source_mode(self):
        # A media storage_path is not the app root. Avoid get_data_dirs(), which
        # loads user config and creates recordings/transcripts/output folders.
        with patch.dict(os.environ, {"STENOAI_USER_DATA_DIR": ""}), patch.object(Path, "home", return_value=self.root), patch.object(sys, "platform", "darwin"):
            expected = self.root / "Library" / "Application Support" / "stenoai" / "ollama.pid"
            for frozen in (False, True):
                with self.subTest(frozen=frozen), patch.object(sys, "frozen", frozen, create=True), patch.object(sys, "_MEIPASS", str(self.bundle), create=True):
                    self.assertEqual(ollama_manager._get_pid_file(), expected)
                    self.assertEqual(ollama_manager._get_pid_file().parent, config.get_user_data_dir())

    def test_clear_removes_only_canonical_user_pid(self):
        self.user_dir.mkdir(parents=True)
        canonical = self.user_dir / "ollama.pid"
        canonical.write_text("424242")
        legacy = self.bundle / "ollama.pid"
        legacy.write_text("123456")
        before = self.snapshot_bundle()
        with patch.object(sys, "frozen", True, create=True), patch.object(sys, "_MEIPASS", str(self.bundle), create=True):
            ollama_manager._clear_pid()
            ollama_manager._clear_pid()  # Missing file is harmless.
        self.assertFalse(canonical.exists())
        self.assertEqual(self.snapshot_bundle(), before)


if __name__ == "__main__":
    unittest.main()
