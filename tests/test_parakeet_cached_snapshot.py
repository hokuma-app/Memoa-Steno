"""Offline loading must use a complete cached snapshot, not a missing main ref."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from src import _parakeet_mlx as engine
from src import parakeet_models


class CachedSnapshotLoadingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.cache = Path(self.tmp.name)
        self.env = patch.dict(os.environ, {'HF_HUB_CACHE': str(self.cache), 'HF_HUB_OFFLINE': '1'})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.addCleanup(engine._MODEL_CACHE.clear)
        engine._MODEL_CACHE.clear()
        self.model_id = engine.DEFAULT_MODEL_ID

    def snapshot(self, revision):
        path = parakeet_models._hf_cache_dir_for(self.model_id) / 'snapshots' / revision
        path.mkdir(parents=True)
        (path / 'config.json').write_text(json.dumps({'model_type': 'fixture'}))
        (path / 'model.safetensors').write_bytes(b'synthetic test weights, never loaded')
        return path

    def test_complete_snapshot_without_main_ref_loads_by_local_path(self):
        snapshot = self.snapshot('downloaded-revision')
        self.assertTrue(parakeet_models.is_installed(self.model_id))
        self.assertFalse((snapshot.parent.parent / 'refs/main').exists())
        model = object()

        def load(source):
            # The dependency falls back to this misleading path when the repo
            # ID cannot resolve refs/main in offline mode, exactly as reported.
            if source == self.model_id:
                raise FileNotFoundError(2, 'No such file or directory', source + '/config.json')
            self.assertEqual(Path(source), snapshot)
            self.assertTrue((Path(source) / 'config.json').is_file())
            return model

        with patch('parakeet_mlx.from_pretrained', side_effect=load) as loader, \
                patch.object(engine, '_configure_mlx_memory', return_value=0):
            self.assertIs(engine._load_model(self.model_id), model)
            self.assertIs(engine._load_model(self.model_id), model)
        loader.assert_called_once_with(str(snapshot))

    def test_main_ref_is_preferred_over_other_complete_snapshots(self):
        preferred = self.snapshot('selected-revision')
        self.snapshot('another-revision')
        refs = preferred.parent.parent / 'refs'
        refs.mkdir()
        (refs / 'main').write_text(preferred.name)
        with patch('parakeet_mlx.from_pretrained', return_value=object()) as loader, \
                patch.object(engine, '_configure_mlx_memory', return_value=0):
            engine._load_model(self.model_id)
        loader.assert_called_once_with(str(preferred))

    def test_missing_snapshot_retains_normal_repository_download_path(self):
        with patch('parakeet_mlx.from_pretrained', return_value=object()) as loader, \
                patch.object(engine, '_configure_mlx_memory', return_value=0):
            engine._load_model(self.model_id)
        loader.assert_called_once_with(self.model_id)

    def test_incomplete_main_ref_uses_complete_snapshot_without_repairing_ref(self):
        complete = self.snapshot('complete')
        incomplete = self.snapshot('incomplete')
        (incomplete / 'model.safetensors').write_bytes(b'')
        refs = complete.parent.parent / 'refs'
        refs.mkdir()
        (refs / 'main').write_text(incomplete.name)
        self.assertEqual(parakeet_models.get_cached_snapshot(self.model_id), complete)
        self.assertEqual((refs / 'main').read_text(), incomplete.name)

    def test_main_ref_cannot_escape_snapshot_directory(self):
        complete = self.snapshot('complete')
        outside = self.cache / 'outside'
        outside.mkdir()
        (outside / 'config.json').write_text('{}')
        (outside / 'model.safetensors').write_bytes(b'fixture')
        refs = complete.parent.parent / 'refs'
        refs.mkdir()
        (refs / 'main').write_text(str(outside))
        self.assertEqual(parakeet_models.get_cached_snapshot(self.model_id), complete)


if __name__ == '__main__':
    unittest.main()
