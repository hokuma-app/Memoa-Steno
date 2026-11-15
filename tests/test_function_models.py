"""A model per function: summary, detail levels (summary_fold) and checklist.

Default is "same as the summary". Existing users keep working without any migration: the new
config fields are optional and absent files behave exactly as before. All servers are owned
loopback stubs; nothing starts Ollama, pulls a model or reads real user data.
"""
import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

from click.testing import CliRunner

SCRATCH = os.environ.get('TMPDIR') or tempfile.gettempdir()


def make_config(**values):
    from src.config import Config
    directory = tempfile.mkdtemp(prefix='fm-', dir=SCRATCH)
    path = Path(directory) / 'config.json'
    if values:
        path.write_text(json.dumps(values))
    return Config(config_path=path), path


def snapshot(**values):
    """The read-only snapshot the checklist CLI builds: real getters, no constructor side effects."""
    from src.config import Config
    config = object.__new__(Config)
    config._config = {'ai_provider': 'local', **values}
    return config


def tags(*rows):
    models = []
    for name, fmt, extra in rows:
        row = {'name': name, 'model': name, 'size': 123, 'digest': 'b' * 64, 'details': {'format': fmt}}
        row.update(extra)
        models.append(row)
    return {'models': models}


class ChatStub:
    """Loopback /api/tags plus /api/chat with a scripted answer; counts chat posts and models."""

    def __init__(self, tag_payload, content='{"assessments": []}'):
        self.tags, self.content, self.posts, self.models = tag_payload, content, 0, []

    def __enter__(self):
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self._send(json.dumps(owner.tags).encode())

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                owner.posts += 1
                owner.models.append(body.get('model'))
                self._send(json.dumps({'message': {'role': 'assistant', 'content': owner.content},
                                       'done': True}).encode())

            def _send(self, body):
                self.send_response(200)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.endpoint = f'http://127.0.0.1:{self.server.server_port}'
        return self

    def __exit__(self, *args):
        self.server.shutdown()
        self.server.server_close()


class ConfigFunctionModels(unittest.TestCase):
    def test_default_is_the_summary_model_for_every_function(self):
        config, _ = make_config(model='gemma4:12b-it-qat')
        for function in ('summary', 'summary_fold', 'checklist'):
            self.assertEqual(config.get_function_model(function), 'gemma4:12b-it-qat', function)
        self.assertEqual(config.get_function_model_choice('summary_fold'), '')
        self.assertEqual(config.get_function_model_choice('checklist'), '')

    def test_each_function_keeps_its_own_choice_across_restart(self):
        config, path = make_config(model='gemma4:e2b-it-qat')
        self.assertTrue(config.set_function_model('summary_fold', 'gemma4:e4b-it-qat'))
        self.assertTrue(config.set_function_model('checklist', 'hf.co/nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-4GB:Q4_K_M'))
        from src.config import Config
        again = Config(config_path=path)
        self.assertEqual(again.get_function_model('summary'), 'gemma4:e2b-it-qat')
        self.assertEqual(again.get_function_model('summary_fold'), 'gemma4:e4b-it-qat')
        self.assertEqual(again.get_function_model('checklist'),
                         'hf.co/nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-4GB:Q4_K_M')

    def test_summary_choice_is_the_existing_global_model(self):
        config, path = make_config()
        self.assertTrue(config.set_function_model('summary', 'qwen3.5:9b'))
        self.assertEqual(json.loads(path.read_text())['model'], 'qwen3.5:9b')
        self.assertEqual(config.get_function_model('summary_fold'), 'qwen3.5:9b')

    def test_empty_choice_returns_a_function_to_same_as_summary(self):
        config, _ = make_config(model='a:1', fold_model='b:2')
        self.assertEqual(config.get_function_model('summary_fold'), 'b:2')
        self.assertTrue(config.set_function_model('summary_fold', ''))
        self.assertEqual(config.get_function_model('summary_fold'), 'a:1')
        self.assertEqual(config.get_function_model_choice('summary_fold'), '')

    def test_refused_choices_leave_the_config_unchanged(self):
        config, path = make_config(model='a:1')
        before = path.read_text()
        for function, name in [('checklist', 'gemma4:31b-cloud'), ('checklist', 'x:cloud'),
                               ('checklist', 'http://evil'), ('checklist', 'a b'), ('checklist', 'x' * 201),
                               ('summary', ''), ('transcribe', 'a:1'), ('summary_fold', None)]:
            with self.subTest(function=function, name=name):
                self.assertFalse(config.set_function_model(function, name))
        self.assertEqual(path.read_text(), before)

    def test_loading_an_existing_config_adds_no_new_fields(self):
        config, path = make_config(model='gemma4:e2b-it-qat', language='nl')
        config.get_function_model('checklist')
        saved = json.loads(path.read_text())
        self.assertNotIn('fold_model', saved)
        self.assertNotIn('checklist_model', saved)

    def test_hand_edited_or_hostile_stored_values_fall_back_to_the_summary_model(self):
        for stored in [5, ['x'], 'gemma4:31b-cloud', 'a b', 'x' * 300, None, {}]:
            config, _ = make_config(model='a:1', fold_model=stored, checklist_model=stored)
            with self.subTest(stored=repr(stored)[:20]):
                self.assertEqual(config.get_function_model('summary_fold'), 'a:1')
                self.assertEqual(config.get_function_model('checklist'), 'a:1')

    def test_unknown_function_reads_as_the_summary_model(self):
        config, _ = make_config(model='a:1')
        with self.assertRaises(ValueError):
            config.get_function_model('transcribe')


class ChecklistUsesItsOwnModel(unittest.TestCase):
    def request(self):
        return {'sessionId': 's', 'revision': 'r1', 'mappingConfirmed': True,
                'criteria': [{'id': 'c1', 'label': 'Prijs toegelicht', 'required': True}],
                'segments': [{'id': 's1', 'text': 'De prijs is tien euro.', 'speaker': 'seller',
                              'start': 0, 'end': 2}]}

    def answer(self):
        return json.dumps({'assessments': [{
            'criterionId': 'c1', 'status': 'covered', 'kind': 'explained', 'customerConfirmed': False,
            'evidence': [{'segmentId': 's1', 'quote': 'De prijs is tien euro'}],
            'customerEvidence': [], 'explanation': 'Uitgelegd.'}]})

    def run_with(self, config, port):
        from src import veneta_checklist as vc
        return vc.evaluate(self.request(), config=config, model_port=port)

    def test_checklist_asks_its_own_model_not_the_summary_model(self):
        port = mock.Mock(return_value=self.answer())
        result = self.run_with(snapshot(model='sum:1', checklist_model='check:2'), port)
        self.assertNotIn('error', result, result)
        self.assertEqual(port.call_args.kwargs['model'], 'check:2')

    def test_without_a_choice_the_checklist_uses_the_summary_model(self):
        port = mock.Mock(return_value=self.answer())
        self.run_with(snapshot(model='sum:1'), port)
        self.assertEqual(port.call_args.kwargs['model'], 'sum:1')

    def test_a_cloud_override_cannot_reach_the_model_port(self):
        port = mock.Mock(return_value=self.answer())
        self.run_with(snapshot(model='sum:1', checklist_model='x:cloud'), port)
        self.assertEqual(port.call_args.kwargs['model'], 'sum:1')

    def test_a_cloud_summary_model_is_still_refused_without_a_call(self):
        port = mock.Mock(return_value=self.answer())
        result = self.run_with(snapshot(model='x:cloud'), port)
        self.assertIn('error', result)
        port.assert_not_called()

    def test_added_models_pass_the_local_check_in_gguf_and_safetensors(self):
        from src import veneta_checklist as vc
        for name, fmt in [('hf.co/nvidia/Repo-1:Q4_K_M', 'gguf'), ('custom/nemo:4b-nvfp4', 'safetensors')]:
            with self.subTest(name=name), ChatStub(tags((name, fmt, {})), self.answer()) as stub:
                result = vc.evaluate(self.request(), config=snapshot(model='sum:1', checklist_model=name),
                                     model_port=vc.OllamaModelPort(stub.endpoint))
                self.assertNotIn('error', result, result)
                self.assertEqual(stub.models, [name])

    def test_remote_and_unknown_format_rows_are_refused_before_any_chat(self):
        from src import veneta_checklist as vc
        rows = [('far:1', 'gguf', {'remote_host': 'https://ollama.com'}),
                ('far:2', 'gguf', {'remote_model': 'big'}),
                ('odd:1', 'onnx', {})]
        for row in rows:
            with self.subTest(row=row[0]), ChatStub(tags(row), self.answer()) as stub:
                result = vc.evaluate(self.request(), config=snapshot(model='sum:1', checklist_model=row[0]),
                                     model_port=vc.OllamaModelPort(stub.endpoint))
                self.assertEqual(result.get('reason'), 'model_not_local')
                self.assertEqual(stub.posts, 0)


class FoldUsesItsOwnModel(unittest.TestCase):
    REQUEST = {'schemaVersion': 2, 'sourceHash': 'a' * 64,
               'sections': [{'id': 'overview', 'title': 'Samenvatting', 'full': 'Eerste zin. Tweede zin.'}]}

    def invoke(self, config, stub_tags=None, answer=None):
        import simple_recorder
        provider = mock.Mock(ai_provider='local')
        result = {'schemaVersion': 2, 'sourceHash': 'a' * 64, 'provenance': 'ai', 'sections': []}
        env = {}
        stub = None
        if stub_tags is not None:
            stub = ChatStub(stub_tags).__enter__()
            env['OLLAMA_HOST'] = stub.endpoint
        try:
            with mock.patch.dict(os.environ, env), \
                    mock.patch('src.config.get_config', return_value=config), \
                    mock.patch.object(simple_recorder, 'OllamaSummarizer', return_value=provider) as factory, \
                    mock.patch('src.summary_folding.prepare_folding', return_value=result) as prepare:
                run = CliRunner().invoke(simple_recorder.cli, ['summary-fold'], input=json.dumps(self.REQUEST))
        finally:
            if stub:
                stub.__exit__()
        return run, factory, prepare, stub

    def test_without_a_choice_the_summarizer_is_built_exactly_as_before(self):
        config, _ = make_config(model='sum:1')
        run, factory, _, _ = self.invoke(config)
        self.assertEqual(run.exit_code, 0, run.output)
        factory.assert_called_once_with()

    def test_a_local_choice_is_verified_then_passed_as_the_model(self):
        config, _ = make_config(model='sum:1', fold_model='fold:2')
        run, factory, _, stub = self.invoke(config, tags(('fold:2', 'safetensors', {})))
        self.assertEqual(run.exit_code, 0, run.output)
        factory.assert_called_once_with(model_name='fold:2')
        self.assertEqual(stub.posts, 0)

    def test_a_remote_row_is_refused_with_a_content_free_reason_and_no_provider(self):
        config, _ = make_config(model='sum:1', fold_model='fold:2')
        run, factory, prepare, _ = self.invoke(config, tags(('fold:2', 'gguf', {'remote_host': 'https://x'})))
        self.assertEqual(run.exit_code, 1)
        self.assertEqual(json.loads(run.output)['reason'], 'provider_unavailable')
        factory.assert_not_called()
        prepare.assert_not_called()

    def test_a_missing_model_is_refused_and_never_pulled(self):
        config, _ = make_config(model='sum:1', fold_model='fold:2')
        with mock.patch('ollama.pull') as pull:
            run, factory, _, _ = self.invoke(config, tags(('other:1', 'gguf', {})))
        self.assertEqual(json.loads(run.output)['reason'], 'provider_unavailable')
        factory.assert_not_called()
        pull.assert_not_called()

    def test_the_choice_is_ignored_when_the_provider_is_not_local(self):
        config, _ = make_config(model='sum:1', fold_model='fold:2', ai_provider='remote',
                                remote_ollama_url='http://example.invalid:11434')
        run, factory, _, _ = self.invoke(config)
        self.assertEqual(run.exit_code, 0, run.output)
        factory.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
