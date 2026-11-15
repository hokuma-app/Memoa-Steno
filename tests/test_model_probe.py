"""'Test dit model': a fixed synthetic conversation run through one function.

Only owned loopback stubs answer; no Ollama is started, nothing is pulled and no real model
runs. The result is content-free: validity, duration and a reason code, never conversation
or model text.
"""
import json
import os
import re
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock


def snapshot(**values):
    from src.config import Config
    config = object.__new__(Config)
    config._config = {'ai_provider': 'local', 'model': 'sum:1', **values}
    return config


def tag_rows(*specs):
    models = []
    for name, fmt, extra in specs:
        row = {'name': name, 'model': name, 'size': 123, 'digest': 'c' * 64, 'details': {'format': fmt}}
        row.update(extra)
        models.append(row)
    return {'models': models}


def checklist_answer(request):
    criteria = json.loads(request['messages'][1]['content'])
    seller = next(s for s in criteria['segments'] if s['speaker'] == 'seller')
    return json.dumps({'assessments': [{
        'criterionId': c['id'], 'status': 'covered', 'kind': 'explained', 'customerConfirmed': False,
        'evidence': [{'segmentId': seller['id'], 'quote': seller['text'].rstrip('.')}],
        'customerEvidence': [], 'explanation': 'Uitgelegd.'} for c in criteria['criteria']]})


def fold_answer(request):
    payload = json.loads(request['messages'][-1]['content'].split('SOURCE DATA:\n', 1)[1])
    items = []
    for section in payload:
        if 'candidates' in section:
            first = section['candidates'][0]
            items.append({'id': section['id'], 'evidence': first['evidence'], 'key': first['key'],
                          'takeaway': first['takeaway'], 'topic': first['topic']})
        else:
            items.append({'id': section['id'], 'evidence': [0], 'key': 'Kern van dit stuk.',
                          'takeaway': 'Kern.', 'topic': 'Onderwerp'})
    return json.dumps({'sections': items})


def summary_answer(request):
    return '## Summary\nEen korte samenvatting van het gesprek.\n\n## Key Points\n- Een punt\n\n## Action Items\n- Een actie'


class ChatStub:
    """Loopback /api/tags and /api/chat; the answer comes from a function of the request body."""

    def __init__(self, tag_payload, answer=None, delay=0.0):
        self.tags, self.delay = tag_payload, delay
        self.answer = answer
        self.posts, self.models, self.requests, self.gets = 0, [], [], []

    def __enter__(self):
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                owner.gets.append(self.path)
                self._send(json.dumps(owner.tags).encode())

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                owner.posts += 1
                owner.models.append(body.get('model'))
                owner.requests.append(body)
                time.sleep(owner.delay)
                content = (owner.answer or default_answer)(body)
                message = {'message': {'role': 'assistant', 'content': content}}
                if body.get('stream'):
                    text = json.dumps(dict(message, done=False)) + '\n' + json.dumps(dict(message, done=True)) + '\n'
                    # The streaming reader sees the content once; send the content in one chunk only.
                    text = json.dumps(dict(message, done=False)) + '\n' + json.dumps(
                        {'message': {'role': 'assistant', 'content': ''}, 'done': True}) + '\n'
                else:
                    text = json.dumps(dict(message, done=True))
                try:
                    self._send(text.encode())
                except OSError:
                    pass

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


def default_answer(request):
    first = request['messages'][0]['content']
    if 'Evaluate this sales checklist' in first:
        return checklist_answer(request)
    if 'SOURCE DATA:' in request['messages'][-1]['content']:
        return fold_answer(request)
    return summary_answer(request)


RESULT_KEYS = {'function', 'model', 'valid', 'ms', 'reason'}


class ProbeEachFunction(unittest.TestCase):
    def run_probe(self, function, config, stub):
        from src.model_probe import run_probe
        with mock.patch('ollama.pull') as pull:
            result = run_probe(function, config, endpoint=stub.endpoint, timeout_s=60)
        pull.assert_not_called()
        return result

    def test_each_function_runs_on_its_own_model_and_reports_a_valid_answer(self):
        config = snapshot(model='sum:1', fold_model='fold:2', checklist_model='check:3')
        names = {'summary': 'sum:1', 'summary_fold': 'fold:2', 'checklist': 'check:3'}
        for function, model in names.items():
            with self.subTest(function=function), ChatStub(tag_rows((model, 'gguf', {}))) as stub:
                result = self.run_probe(function, config, stub)
                self.assertEqual(set(result), RESULT_KEYS)
                self.assertEqual((result['function'], result['model']), (function, model))
                self.assertTrue(result['valid'], result)
                self.assertIsNone(result['reason'])
                self.assertIsInstance(result['ms'], int)
                self.assertGreaterEqual(result['ms'], 0)
                self.assertGreaterEqual(stub.posts, 1)
                self.assertEqual(set(stub.models), {model})

    def test_function_without_its_own_choice_uses_the_summary_model(self):
        with ChatStub(tag_rows(('sum:1', 'safetensors', {}))) as stub:
            result = self.run_probe('checklist', snapshot(model='sum:1'), stub)
        self.assertTrue(result['valid'], result)
        self.assertEqual(result['model'], 'sum:1')

    def test_the_fixture_is_synthetic_and_the_result_leaks_no_text(self):
        with ChatStub(tag_rows(('sum:1', 'gguf', {}))) as stub:
            result = self.run_probe('checklist', snapshot(), stub)
        text = json.dumps(result, ensure_ascii=False)
        sent = json.dumps(stub.requests, ensure_ascii=False)
        self.assertIn('synthetisch', sent.lower())
        for sentence in re.findall(r'[A-Z][^.]{12,}\.', sent)[:5]:
            self.assertNotIn(sentence, text)

    def test_unusable_answers_are_invalid_with_a_content_free_reason(self):
        garbage = lambda request: 'Geheime modeltekst die nooit terug mag komen'  # noqa: E731
        for function in ('summary', 'summary_fold', 'checklist'):
            with self.subTest(function=function), ChatStub(tag_rows(('sum:1', 'gguf', {})), garbage) as stub:
                result = self.run_probe(function, snapshot(), stub)
                self.assertFalse(result['valid'], result)
                self.assertIn(result['reason'], {'invalid_answer', 'invalid_structure', 'not_json'})
                self.assertNotIn('Geheime', json.dumps(result))

    def test_remote_model_is_refused_before_any_chat(self):
        for extra in ({'remote_host': 'https://ollama.com'}, {'remote_model': 'x'}):
            with ChatStub(tag_rows(('sum:1', 'gguf', extra))) as stub:
                result = self.run_probe('summary', snapshot(), stub)
                self.assertFalse(result['valid'])
                self.assertEqual(result['reason'], 'model_not_local')
                self.assertEqual(stub.posts, 0)

    def test_missing_model_is_reported_and_never_downloaded(self):
        with ChatStub(tag_rows(('another:1', 'gguf', {}))) as stub:
            result = self.run_probe('summary_fold', snapshot(), stub)
        self.assertEqual(result['reason'], 'model_missing')
        self.assertEqual(stub.posts, 0)

    def test_non_local_provider_is_refused_without_contacting_anything(self):
        for provider in ('cloud', 'remote', 'adapter'):
            with ChatStub(tag_rows(('sum:1', 'gguf', {}))) as stub:
                result = self.run_probe('summary', snapshot(ai_provider=provider), stub)
                self.assertEqual(result['reason'], 'provider_not_local', provider)
                self.assertEqual((stub.posts, stub.gets), (0, []))

    def test_unknown_function_and_cloud_model_are_refused(self):
        with ChatStub(tag_rows(('sum:1', 'gguf', {}))) as stub:
            self.assertEqual(self.run_probe('transcribe', snapshot(), stub)['reason'], 'invalid_request')
            self.assertEqual(self.run_probe('summary', snapshot(model='x:cloud'), stub)['reason'], 'failed')
            self.assertEqual(stub.posts, 0)

    def test_a_server_that_is_not_there_is_unreachable_and_not_started(self):
        import socket
        from src.model_probe import run_probe
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        with mock.patch('src.veneta_checklist.start_local_server') as starter:
            result = run_probe('summary', snapshot(), endpoint=f'http://127.0.0.1:{port}', timeout_s=30)
        self.assertEqual(result['reason'], 'server_unreachable')
        starter.assert_not_called()

    def test_overall_deadline_ends_a_slow_model_as_timeout(self):
        from src.model_probe import run_probe
        with ChatStub(tag_rows(('sum:1', 'gguf', {})), delay=3.0) as stub:
            started = time.monotonic()
            result = run_probe('summary', snapshot(), endpoint=stub.endpoint, timeout_s=0.5)
        self.assertEqual(result['reason'], 'timeout')
        self.assertFalse(result['valid'])
        self.assertLess(time.monotonic() - started, 2.5)


class ProbeCommand(unittest.TestCase):
    def setUp(self):
        self.data = tempfile.mkdtemp(prefix='probe-', dir=os.environ.get('TMPDIR'))
        Path(self.data, 'config.json').write_text(json.dumps(
            {'model': 'sum:1', 'checklist_model': 'check:3', 'ai_provider': 'local'}))

    def invoke(self, function, stub):
        from click.testing import CliRunner
        import simple_recorder
        env = {'STENOAI_USER_DATA_DIR': self.data, 'OLLAMA_HOST': stub.endpoint}
        with mock.patch.dict(os.environ, env):
            return CliRunner().invoke(simple_recorder.cli, ['test-model-function', function])

    def test_cli_prints_one_json_result_for_the_chosen_function(self):
        with ChatStub(tag_rows(('check:3', 'gguf', {}))) as stub:
            run = self.invoke('checklist', stub)
        self.assertEqual(run.exit_code, 0, run.output)
        result = json.loads(run.output)
        self.assertEqual(set(result), RESULT_KEYS | {'success'})
        self.assertTrue(result['valid'])
        self.assertEqual(result['model'], 'check:3')

    def test_cli_does_not_change_the_saved_configuration(self):
        before = Path(self.data, 'config.json').read_text()
        with ChatStub(tag_rows(('check:3', 'gguf', {}))) as stub:
            self.invoke('checklist', stub)
        self.assertEqual(Path(self.data, 'config.json').read_text(), before)

    def test_cli_rejects_an_unknown_function_without_a_model_call(self):
        with ChatStub(tag_rows(('sum:1', 'gguf', {}))) as stub:
            run = self.invoke('transcribe', stub)
        self.assertNotEqual(run.exit_code, 0)
        self.assertEqual(stub.posts, 0)


if __name__ == '__main__':
    unittest.main()
