"""CLI contract of the model choices: list, choose, preview an addition, pull and delete safely.

Owned loopback stubs stand in for Ollama and the public registry; ``ollama.pull`` and
``ollama.delete`` are patched so nothing is downloaded or removed.
"""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from click.testing import CliRunner

from tests.test_model_catalog import Stub, closed_port, tags_row


def make_config(**values):
    from src.config import Config
    directory = tempfile.mkdtemp(prefix='mc-', dir=os.environ.get('TMPDIR'))
    path = Path(directory) / 'config.json'
    if values:
        path.write_text(json.dumps(values))
    return Config(config_path=path), path


def run(args, config, host=None, apple_silicon=False, extra=None):
    import simple_recorder
    env = {'OLLAMA_HOST': host or f'http://127.0.0.1:{closed_port()}'}
    patches = [mock.patch.dict(os.environ, env),
               mock.patch('src.config.get_config', return_value=config),
               mock.patch('src.config.is_apple_silicon', return_value=apple_silicon)]
    for target, kwargs in (extra or {}).items():
        patches.append(mock.patch(target, **kwargs))
    for patch in patches:
        patch.start()
    try:
        return CliRunner().invoke(simple_recorder.cli, args)
    finally:
        for patch in reversed(patches):
            patch.stop()


def tags(*rows):
    return {'/api/tags': (200, {'models': list(rows)})}


class ModelChoices(unittest.TestCase):
    def choices(self, config, rows=(), apple_silicon=False, **kwargs):
        with Stub(tags(*rows)) as stub:
            result = run(['model-choices'], config, stub.base, apple_silicon, **kwargs)
            self.assertEqual([m for m, _, _ in stub.requests if m != 'GET'], [])
        self.assertEqual(result.exit_code, 0, result.output)
        return json.loads(result.output)

    def test_reports_each_function_with_its_choice_and_effective_model(self):
        config, _ = make_config(model='sum:1', checklist_model='check:2')
        data = self.choices(config)
        self.assertTrue(data['success'])
        self.assertEqual(data['functions']['summary'], {'choice': 'sum:1', 'effective': 'sum:1'})
        self.assertEqual(data['functions']['summary_fold'], {'choice': '', 'effective': 'sum:1'})
        self.assertEqual(data['functions']['checklist'], {'choice': 'check:2', 'effective': 'check:2'})
        # 0.11.0: the agenda follows the checklist until it gets a choice of its own.
        self.assertEqual(data['functions']['agenda'], {'choice': '', 'effective': 'check:2'})

    def test_installed_list_is_live_from_tags_and_names_the_functions_using_each_model(self):
        config, _ = make_config(model='gemma4:e2b-it-qat', checklist_model='extra:1')
        rows = [tags_row('gemma4:e2b-it-qat'), tags_row('extra:1', details={
            'format': 'safetensors', 'quantization_level': 'nvfp4'}), tags_row('unused:9')]
        data = self.choices(config, rows)
        self.assertTrue(data['server_running'])
        installed = {m['name']: m for m in data['installed']}
        self.assertEqual(set(installed), {'gemma4:e2b-it-qat', 'extra:1', 'unused:9'})
        self.assertEqual(installed['gemma4:e2b-it-qat']['functions'], ['summary', 'summary_fold'])
        self.assertEqual(installed['extra:1']['functions'], ['checklist', 'agenda'], 'the agenda follows the checklist')
        self.assertEqual(installed['unused:9']['functions'], [])
        self.assertEqual((installed['extra:1']['format'], installed['extra:1']['quantization']),
                         ('safetensors', 'nvfp4'))

    def test_remote_and_cloud_rows_are_not_offered(self):
        config, _ = make_config(model='sum:1')
        rows = [tags_row('far:1', remote_host='https://ollama.com'), tags_row('gemma4:31b-cloud'),
                tags_row('here:1')]
        data = self.choices(config, rows)
        self.assertEqual([m['name'] for m in data['installed']], ['here:1'])

    def test_a_stopped_server_gives_an_empty_installed_list_and_is_not_started(self):
        config, _ = make_config(model='sum:1')
        with mock.patch('src.ollama_manager.start_ollama_server') as starter:
            result = run(['model-choices'], config, f'http://127.0.0.1:{closed_port()}')
        starter.assert_not_called()
        data = json.loads(result.output)
        self.assertFalse(data['server_running'])
        self.assertEqual(data['installed'], [])
        self.assertTrue(data['catalog'])

    def test_catalogue_entries_carry_badges_sizes_and_install_state(self):
        config, _ = make_config(model='gemma4:e2b-it-qat')
        data = self.choices(config, [tags_row('gemma4:e2b-it-qat')])
        catalog = {m['id']: m for m in data['catalog']}
        e2b = catalog['gemma4-e2b']
        self.assertEqual((e2b['status'], e2b['device_class']), ('aanbevolen', 'klein'))
        self.assertTrue(e2b['installed'])
        self.assertEqual((e2b['choice_name'], e2b['pull_tag']), ('gemma4:e2b-it-qat', 'gemma4:e2b-it-qat'))
        self.assertEqual(e2b['pull_size_bytes'], 4336358185)
        self.assertFalse(catalog['gemma4-e4b']['installed'])
        bolt = catalog['nemotron-3-5-bolt-e4b']
        self.assertEqual((bolt['status'], bolt['device_class']), ('kandidaat', 'klein'))
        self.assertEqual(bolt['pull_tag'], 'hf.co/nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-4GB:Q4_K_M')
        lightning = catalog['nemotron-3-5-lightning-30b-a3b']
        self.assertEqual((lightning['pull_tag'], lightning['choice_name']), ('', ''))
        self.assertEqual(lightning['status'], 'kandidaat')

    def test_apple_silicon_pulls_the_nvfp4_build_and_recognises_it_as_installed(self):
        config, _ = make_config(model='gemma4:e2b-it-qat')
        data = self.choices(config, [tags_row('gemma4:e2b-nvfp4', details={'format': 'safetensors'})],
                            apple_silicon=True)
        e2b = {m['id']: m for m in data['catalog']}['gemma4-e2b']
        self.assertEqual(e2b['pull_tag'], 'gemma4:e2b-nvfp4')
        self.assertEqual(e2b['pull_size_bytes'], 7476595162)
        self.assertEqual(e2b['choice_name'], 'gemma4:e2b-it-qat')
        self.assertTrue(e2b['installed'])
        off = self.choices(config, [], apple_silicon=False)
        self.assertEqual({m['id']: m for m in off['catalog']}['gemma4-e2b']['pull_tag'], 'gemma4:e2b-it-qat')

    def test_a_broken_catalogue_degrades_to_the_live_list_with_a_reason(self):
        from src.model_catalog import CatalogError
        config, _ = make_config(model='sum:1')
        data = self.choices(config, [tags_row('sum:1')],
                            extra={'src.model_catalog.load_catalog': {'side_effect': CatalogError('x')}})
        self.assertEqual(data['catalog'], [])
        self.assertEqual(data['catalog_error'], 'catalog_invalid')
        self.assertEqual([m['name'] for m in data['installed']], ['sum:1'])

    def test_listing_is_read_only(self):
        config, path = make_config(model='sum:1')
        before = path.read_text()
        self.choices(config, [tags_row('sum:1')])
        self.assertEqual(path.read_text(), before)


class SetFunctionModel(unittest.TestCase):
    def test_choice_is_stored_per_function_and_reported(self):
        config, path = make_config(model='sum:1')
        result = run(['set-function-model', 'summary_fold', 'fold:2'], config)
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertEqual(json.loads(result.output), {
            'success': True, 'function': 'summary_fold', 'choice': 'fold:2', 'effective': 'fold:2'})
        saved = json.loads(path.read_text())
        self.assertEqual((saved['fold_model'], saved['model']), ('fold:2', 'sum:1'))
        self.assertNotIn('checklist_model', saved)

    def test_same_as_summary_is_an_empty_choice(self):
        config, _ = make_config(model='sum:1', checklist_model='x:1')
        result = run(['set-function-model', 'checklist', ''], config)
        data = json.loads(result.output)
        self.assertEqual((data['choice'], data['effective']), ('', 'sum:1'))

    def test_refusals_carry_a_reason_and_change_nothing(self):
        config, path = make_config(model='sum:1')
        before = path.read_text()
        for args, reason in [(['checklist', 'gemma4:31b-cloud'], 'cloud'), (['checklist', 'a b'], 'invalid'),
                             (['transcribe', 'x:1'], 'invalid_function'), (['summary', ''], 'empty')]:
            with self.subTest(args=args):
                result = run(['set-function-model'] + args, config)
                self.assertEqual(result.exit_code, 1)
                data = json.loads(result.output)
                self.assertFalse(data['success'])
                self.assertEqual(data['reason'], reason)
        self.assertEqual(path.read_text(), before)


class AddPreview(unittest.TestCase):
    def preview(self, name, size=None, rows=(), **extra):
        config, _ = make_config(model='sum:1')
        patches = {'src.model_catalog.registry_size': {'return_value': size}}
        patches.update(extra)
        with Stub(tags(*rows)) as stub:
            result = run(['model-add-preview', name], config, stub.base, extra=patches)
        return result, json.loads(result.output)

    def test_valid_name_shows_size_installed_state_and_disk_check(self):
        result, data = self.preview('hf.co/org/repo:Q4_K_M', size=3 * 1024 ** 3,
                                    **{'src.model_catalog.check_disk_space': {
                                        'return_value': {'ok': True, 'free_bytes': 9, 'needed_bytes': 4}}})
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertTrue(data['success'])
        self.assertEqual((data['name'], data['kind'], data['size_bytes'], data['installed']),
                         ('hf.co/org/repo:Q4_K_M', 'hf', 3 * 1024 ** 3, False))
        self.assertEqual(data['disk'], {'ok': True, 'free_bytes': 9, 'needed_bytes': 4})

    def test_unknown_size_is_null_not_a_guess(self):
        _, data = self.preview('gemma4:e2b-it-qat', size=None)
        self.assertTrue(data['success'])
        self.assertIsNone(data['size_bytes'])

    def test_already_installed_is_reported(self):
        _, data = self.preview('here:1', rows=[tags_row('here:1')])
        self.assertTrue(data['installed'])

    def test_cloud_and_malformed_names_are_refused_without_any_lookup(self):
        for name, reason in [('gemma4:31b-cloud', 'cloud'), ('a b', 'invalid'), ('', 'empty'),
                             ('x' * 201, 'too_long')]:
            with self.subTest(name=name[:20]):
                config, _ = make_config(model='sum:1')
                lookup = mock.Mock(return_value=5)
                result = run(['model-add-preview', name], config, extra={
                    'src.model_catalog.registry_size': {'new': lookup}})
                data = json.loads(result.output)
                self.assertFalse(data['success'])
                self.assertEqual(data['reason'], reason)
                lookup.assert_not_called()

    def test_preview_never_pulls(self):
        with mock.patch('ollama.pull') as pull:
            self.preview('gemma4:e2b-it-qat', size=1)
        pull.assert_not_called()


class PullIsGuarded(unittest.TestCase):
    def pull(self, name, disk_ok=True, size=2 * 1024 ** 3):
        events = [mock.Mock(status='pulling model', total=1000, completed=500)]
        config, _ = make_config(model='sum:1')
        with mock.patch('ollama.pull', return_value=iter(events)) as pull, \
                mock.patch('src.ollama_manager.start_ollama_server', return_value=True) as starter:
            result = run(['pull-model', name], config, extra={
                'src.model_catalog.registry_size': {'return_value': size},
                'src.model_catalog.check_disk_space': {'return_value': {
                    'ok': disk_ok, 'free_bytes': 1, 'needed_bytes': 9}}})
        return result, pull, starter

    def test_cloud_and_malformed_names_never_reach_ollama(self):
        for name, reason in [('gemma4:31b-cloud', 'cloud'), ('http://evil/x', 'invalid'), ('a b', 'invalid')]:
            with self.subTest(name=name):
                result, pull, starter = self.pull(name)
                data = json.loads(result.output.strip().splitlines()[-1])
                self.assertFalse(data['success'])
                self.assertEqual(data['reason'], reason)
                pull.assert_not_called()
                starter.assert_not_called()

    def test_not_enough_disk_space_stops_before_the_download(self):
        result, pull, starter = self.pull('hf.co/org/repo:Q4_K_M', disk_ok=False)
        data = json.loads(result.output.strip().splitlines()[-1])
        self.assertEqual((data['success'], data['reason']), (False, 'disk_full'))
        pull.assert_not_called()
        starter.assert_not_called()

    def test_an_added_model_downloads_with_progress_after_the_checks(self):
        result, pull, _ = self.pull('hf.co/org/repo:Q4_K_M')
        lines = result.output.strip().splitlines()
        self.assertIn('pulling model 50% (500/1000) [Part 1]', lines)
        self.assertTrue(json.loads(lines[-1])['success'])
        pull.assert_called_once_with('hf.co/org/repo:Q4_K_M', stream=True)


class DeleteIsGuarded(unittest.TestCase):
    def delete(self, name, config, rows=(), apple_silicon=False):
        with Stub(tags(*rows)) as stub, mock.patch('ollama.delete') as delete:
            result = run(['delete-model', name], config, stub.base, apple_silicon)
        return json.loads(result.output), delete

    def test_an_added_model_that_is_installed_locally_and_unused_can_be_deleted(self):
        config, _ = make_config(model='sum:1')
        data, delete = self.delete('hf.co/org/repo:Q4_K_M', config, [tags_row('hf.co/org/repo:Q4_K_M')])
        self.assertTrue(data['success'], data)
        delete.assert_called_once_with(model='hf.co/org/repo:Q4_K_M')

    def test_a_model_chosen_for_any_function_is_refused_and_names_the_functions(self):
        config, _ = make_config(model='sum:1', checklist_model='check:2')
        data, delete = self.delete('check:2', config, [tags_row('check:2')])
        self.assertFalse(data['success'])
        self.assertEqual((data['reason'], data['functions']), ('in_use', ['checklist', 'agenda']))
        delete.assert_not_called()
        data, delete = self.delete('sum:1', config, [tags_row('sum:1')])
        self.assertEqual(data['functions'], ['summary', 'summary_fold'])
        delete.assert_not_called()

    def test_unknown_remote_and_cloud_rows_are_refused(self):
        config, _ = make_config(model='sum:1')
        for name, rows in [('ghost:1', []), ('far:1', [tags_row('far:1', remote_host='https://x')]),
                           ('gemma4:31b-cloud', [tags_row('gemma4:31b-cloud')])]:
            with self.subTest(name=name):
                data, delete = self.delete(name, config, rows)
                self.assertFalse(data['success'])
                delete.assert_not_called()

    def test_apple_silicon_gguf_blob_is_deletable_but_the_running_nvfp4_tag_is_not(self):
        config, _ = make_config(model='gemma4:e2b-it-qat')
        data, delete = self.delete('gemma4:e2b-it-qat', config, apple_silicon=True)
        self.assertTrue(data['success'], data)
        delete.assert_called_once_with(model='gemma4:e2b-it-qat')
        data, delete = self.delete('gemma4:e2b-nvfp4', config, apple_silicon=True)
        self.assertEqual(data['reason'], 'in_use')
        delete.assert_not_called()


if __name__ == '__main__':
    unittest.main()
