"""Model-free regression tests for Memoa Test's ASR storage boundary."""
import ast
import builtins
import logging
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import MagicMock, patch

from src import whisper_models

ROOT = Path(__file__).resolve().parents[1]
OVERRIDE = "MEMOA_WHISPER_MODELS_DIR"


def extracted_function(filename, name, namespace):
    """Execute the real function without importing audio/native app dependencies."""
    tree = ast.parse((ROOT / filename).read_text())
    node = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == name)
    node.decorator_list = []
    exec(compile(ast.Module(body=[node], type_ignores=[]), filename, "exec"), namespace)
    return namespace[name]


class ModelDirectoryTests(unittest.TestCase):
    def test_override_precedes_even_importing_pywhispercpp(self):
        original_import = builtins.__import__
        native_imports = []

        def guarded_import(name, *args, **kwargs):
            if name.startswith("pywhispercpp"):
                native_imports.append(name)
                self.fail("Memoa path resolution must not import pywhispercpp")
            return original_import(name, *args, **kwargs)

        with patch.dict(os.environ, {OVERRIDE: "/isolated/models/whisper"}), \
                patch("builtins.__import__", side_effect=guarded_import):
            self.assertEqual(whisper_models.get_models_dir(), Path("/isolated/models/whisper"))
        self.assertEqual(native_imports, [])

    def test_production_still_uses_pywhispercpp_default(self):
        constants = types.ModuleType("pywhispercpp.constants")
        constants.MODELS_DIR = "/existing/production/models"
        with patch.dict(os.environ), patch.dict(sys.modules, {"pywhispercpp.constants": constants}):
            os.environ.pop(OVERRIDE, None)
            self.assertEqual(whisper_models.get_models_dir(), Path(constants.MODELS_DIR))

    def test_status_and_download_only_use_owned_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            own = Path(tmp) / "memoa" / "models" / "whisper"
            shared = Path(tmp) / "shared"
            shared.mkdir()
            shared_file = shared / "ggml-large-v3-turbo.bin"
            shared_file.write_bytes(b"production sentinel")
            constants = types.ModuleType("pywhispercpp.constants")
            constants.MODELS_DIR = str(shared)
            response = MagicMock()
            response.__enter__.return_value = response
            response.headers = {"content-length": "4"}
            response.iter_content.return_value = iter([b"test"])
            with patch.dict(os.environ, {OVERRIDE: str(own)}), \
                    patch.dict(sys.modules, {"pywhispercpp.constants": constants}), \
                    patch("requests.get", return_value=response) as request:
                self.assertFalse(whisper_models.is_installed("large-v3-turbo"))
                self.assertTrue(whisper_models.download_with_progress("large-v3-turbo", lambda *a: None))
                request.assert_called_once()
                self.assertTrue(whisper_models.is_installed("large-v3-turbo"))
                self.assertEqual(whisper_models.model_file_path("large-v3-turbo"), own / shared_file.name)
            self.assertEqual((own / shared_file.name).read_bytes(), b"test")
            self.assertEqual(list(own.iterdir()), [own / shared_file.name])
            self.assertEqual(list(shared.iterdir()), [shared_file])
            self.assertEqual(shared_file.read_bytes(), b"production sentinel")


    def test_download_does_not_create_missing_shared_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            own = Path(tmp) / "memoa" / "models" / "whisper"
            shared = Path(tmp) / "absent-production-cache"
            constants = types.ModuleType("pywhispercpp.constants")
            constants.MODELS_DIR = str(shared)
            response = MagicMock()
            response.__enter__.return_value = response
            response.headers = {"content-length": "4"}
            response.iter_content.return_value = iter([b"test"])
            with patch.dict(os.environ, {OVERRIDE: str(own)}), \
                    patch.dict(sys.modules, {"pywhispercpp.constants": constants}), \
                    patch("requests.get", return_value=response):
                self.assertTrue(whisper_models.download_with_progress("large-v3-turbo", lambda *a: None))
            self.assertTrue((own / "ggml-large-v3-turbo.bin").exists())
            self.assertFalse(shared.exists())


class LoaderIsolationTests(unittest.TestCase):
    def transcriber_class(self, model, parakeet_available=True):
        namespace = {
            "os": os, "logger": logging.getLogger(__name__), "WhisperCppModel": model,
            "WHISPER_CPP_AVAILABLE": True, "PARAKEET_AVAILABLE": parakeet_available,
        }
        methods = {name: extracted_function("src/transcriber.py", name, namespace)
                   for name in ["_load_whisper_cpp", "_build_whisper_fallback"]}
        # Select the ASR class's constructor, not an unrelated class's __init__.
        tree = ast.parse((ROOT / "src/transcriber.py").read_text())
        cls = next(n for n in tree.body if isinstance(n, ast.ClassDef)
                   and any(isinstance(m, ast.FunctionDef) and m.name == "_load_whisper_cpp" for m in n.body))
        init = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == "__init__")
        exec(compile(ast.Module(body=[init], type_ignores=[]), "src/transcriber.py", "exec"), namespace)
        methods["__init__"] = namespace["__init__"]
        methods["_ensure_ffmpeg_in_path"] = lambda self: None
        return type("IsolatedTranscriber", (), methods)

    def test_all_transcriber_load_paths_keep_production_signature_or_use_override(self):
        for override in [None, "/isolated/models/whisper"]:
            for route in ["selected-whisper", "intel-fallback", "crash-fallback"]:
                with self.subTest(override=override, route=route), patch.dict(os.environ):
                    if override is None:
                        os.environ.pop(OVERRIDE, None)
                    else:
                        os.environ[OVERRIDE] = override
                    model = MagicMock()
                    cls = self.transcriber_class(model, parakeet_available=route != "intel-fallback")
                    config = MagicMock()
                    config.get_transcription_engine.return_value = "whisper" if route == "selected-whisper" else "parakeet"
                    fake_config = types.ModuleType("src.config")
                    fake_config.get_config = lambda: config
                    with patch.dict(sys.modules, {"src.config": fake_config}), \
                            patch("multiprocessing.cpu_count", return_value=8), \
                            patch.object(whisper_models, "is_installed", return_value=True):
                        transcriber = cls("large-v3-turbo")
                        if route == "crash-fallback":
                            model.assert_not_called()
                            self.assertTrue(transcriber._build_whisper_fallback())
                    kwargs = {"n_threads": 6}
                    if override:
                        kwargs["models_dir"] = override
                    model.assert_called_once_with("large-v3-turbo", **kwargs)
                    self.assertIs(transcriber.model, model.return_value)

    def test_direct_download_command_keeps_production_signature_or_uses_override(self):
        for override in [None, "/isolated/models/whisper"]:
            with self.subTest(override=override), patch.dict(os.environ):
                if override is None:
                    os.environ.pop(OVERRIDE, None)
                else:
                    os.environ[OVERRIDE] = override
                model_module = types.ModuleType("pywhispercpp.model")
                model_module.Model = MagicMock()
                config = MagicMock()
                config.get_whisper_model.return_value = "large-v3-turbo"
                config_module = types.ModuleType("src.config")
                config_module.get_config = lambda: config
                command = extracted_function("simple_recorder.py", "download_whisper_model", {"os": os})
                with patch.dict(sys.modules, {"pywhispercpp.model": model_module, "src.config": config_module}), \
                        patch("builtins.print"):
                    command()
                kwargs = {"models_dir": override} if override else {}
                model_module.Model.assert_called_once_with("large-v3-turbo", **kwargs)


if __name__ == "__main__":
    unittest.main()
