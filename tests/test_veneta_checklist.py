"""Model-free contract tests; all filesystem roots are managed scratch."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

SCRATCH = Path(os.environ.get('TMPDIR') or tempfile.gettempdir())


def request():
    return {'sessionId': '../not-a-path', 'revision': 'r1', 'mappingConfirmed': True,
            'criteria': [{'id': 'c1', 'label': 'Prijs toegelicht', 'required': True}],
            'segments': [{'id': 's1', 'text': 'De prijs is tien euro.',
                          'speaker': 'seller', 'start': 0, 'end': 2}]}


class InputTests(unittest.TestCase):
    def test_module_and_strict_request_contract(self):
        self.assertIsNotNone(importlib.util.find_spec('src.veneta_checklist'),
                             'checklist evaluator module is missing')
        from src.veneta_checklist import validate_request
        data = request()
        self.assertEqual(validate_request(data), data)
        invalid = []
        for key in data:
            item = copy.deepcopy(data)
            del item[key]
            invalid.append(item)
        for field, value in [('url', 'https://cloud'), ('revision', ''),
                             ('revision', 'r' * 129), ('mappingConfirmed', 1)]:
            item = copy.deepcopy(data)
            item[field] = value
            invalid.append(item)
        for collection in ('criteria', 'segments'):
            item = copy.deepcopy(data)
            item[collection] *= 2
            invalid.append(item)
            item = copy.deepcopy(data)
            item[collection][0]['extra'] = True
            invalid.append(item)
        for field, value in [('start', True), ('end', float('nan')),
                             ('end', float('inf')), ('start', -1),
                             ('end', -1), ('speaker', 'customer')]:
            item = copy.deepcopy(data)
            item['segments'][0][field] = value
            invalid.append(item)
        item = copy.deepcopy(data)
        item['criteria'][0]['required'] = 1
        invalid.append(item)
        for collection, maximum in [('criteria', 32), ('segments', 256)]:
            item = copy.deepcopy(data)
            item[collection] = [dict(item[collection][0], id=str(i)) for i in range(maximum+1)]
            invalid.append(item)
        item = copy.deepcopy(data)
        item['segments'][0]['text'] = 'x' * 24000
        invalid.append(item)
        for item in invalid:
            with self.subTest(item=str(item)[:80]), self.assertRaises(ValueError):
                validate_request(item)


    def test_extreme_numbers_are_rejected_as_validation_errors(self):
        from src.veneta_checklist import validate_request
        data = request()
        data['segments'][0]['end'] = 10 ** 1000
        with self.assertRaises(ValueError):
            validate_request(data)

    def test_exact_limits_and_empty_collections(self):
        from src.veneta_checklist import validate_request
        data = request()
        data['criteria'][0]['label'] = 'x'
        data['segments'][0]['text'] = 'x' * 23999
        self.assertEqual(validate_request(data), data)
        data['criteria'] = [dict(data['criteria'][0], id=str(i)) for i in range(32)]
        data['segments'] = [dict(data['segments'][0], id=str(i), text='') for i in range(256)]
        self.assertEqual(validate_request(data), data)
        data['criteria'] = []
        data['segments'] = []
        self.assertEqual(validate_request(data), data)


class RequestFileTests(unittest.TestCase):
    @unittest.skipUnless(os.name == 'posix', 'descriptor traversal requires POSIX')
    def test_ancestor_swap_before_file_open_never_reads_outside_root(self):
        from src import veneta_checklist as vc
        from unittest import mock
        with tempfile.TemporaryDirectory(dir=SCRATCH, prefix='checklist-race-') as tmp:
            root = Path(tmp)
            userdata = root / 'userdata'
            ancestor = userdata / 'nested'
            ancestor.mkdir(parents=True)
            outside = root / 'outside'
            outside.mkdir()
            for directory, revision in ((ancestor, 'inside'), (outside, 'outside')):
                source = directory / 'request.json'
                source.write_text(json.dumps(dict(request(), revision=revision)))
                source.chmod(0o600)
            original_open = os.open
            swapped = []

            def swap_then_open(path, flags, *args, **kwargs):
                if Path(path).name == 'request.json' and not swapped:
                    ancestor.rename(userdata / 'original')
                    ancestor.symlink_to(outside, target_is_directory=True)
                    swapped.append(True)
                return original_open(path, flags, *args, **kwargs)

            with mock.patch.dict(os.environ, {'STENOAI_USER_DATA_DIR': str(userdata)}), \
                    mock.patch('os.open', side_effect=swap_then_open) as opening, \
                    mock.patch.object(os, 'supports_dir_fd', os.supports_dir_fd | {opening}):
                try:
                    result = vc.read_request_file(ancestor / 'request.json')
                except (OSError, ValueError):
                    result = None  # Rejection is safe; outside content is never acceptable.
            self.assertTrue(swapped, 'deterministic swap hook did not execute')
            if result is not None:
                self.assertEqual(result['revision'], 'inside', 'read escaped the user-data root')


    @unittest.skipUnless(os.name == 'posix', 'descriptor traversal requires POSIX')
    def test_symlinks_at_each_descendant_are_rejected(self):
        from src import veneta_checklist as vc
        from unittest import mock
        with tempfile.TemporaryDirectory(dir=SCRATCH, prefix='checklist-links-') as tmp:
            root = Path(tmp)
            actual = root / 'actual'
            nested = actual / 'nested'
            nested.mkdir(parents=True)
            source = nested / 'request.json'
            source.write_text(json.dumps(request()))
            source.chmod(0o600)
            (root / 'first-link').symlink_to(actual, target_is_directory=True)
            (actual / 'second-link').symlink_to(nested, target_is_directory=True)
            (nested / 'file-link.json').symlink_to(source)
            with mock.patch.dict(os.environ, {'STENOAI_USER_DATA_DIR': str(root)}):
                for path in (root / 'first-link/nested/request.json',
                             actual / 'second-link/request.json', nested / 'file-link.json'):
                    with self.subTest(path=path), self.assertRaises((OSError, ValueError)):
                        vc.read_request_file(path)
                self.assertEqual(vc.read_request_file(source), request())

    def test_missing_directory_descriptor_support_fails_closed_without_open(self):
        from src import veneta_checklist as vc
        from unittest import mock
        with mock.patch.object(os, 'supports_dir_fd', set()), mock.patch('os.open') as opening:
            with self.assertRaises(ValueError):
                vc.read_request_file('request.json')
            opening.assert_not_called()


class ResponseTests(unittest.TestCase):
    def test_evidence_validation_and_conservative_coverage(self):
        from src import veneta_checklist as vc
        self.assertTrue(callable(getattr(vc, 'validate_response', None)), 'response validator missing')
        data = request()
        row = {'criterionId': 'c1', 'status': 'covered',
               'evidence': [{'segmentId': 's1', 'quote': 'tien euro'}], 'explanation': 'Toegelicht.'}
        self.assertEqual(vc.validate_response({'assessments': [row]}, data)['assessments'],
                         [dict(row, kind='explained', customerConfirmed=False, customerEvidence=[])])
        self.assertEqual(vc.validate_response({'assessments': []}, data)['assessments'][0]['status'], 'uncertain')
        for speaker, confirmed in [('unknown', True), ('other', True), ('seller', False)]:
            changed = copy.deepcopy(data)
            changed['segments'][0]['speaker'] = speaker
            changed['mappingConfirmed'] = confirmed
            self.assertEqual(vc.validate_response({'assessments': [row]}, changed)['assessments'][0]['status'], 'uncertain')
        invalid = [{'assessments': [row, row]}, {'assessments': [dict(row, criterionId='alien')]},
                   {'assessments': [row], 'revision': 'model-forged'},
                   {'assessments': [dict(row, path='/tmp/file')]},
                   {'assessments': [dict(row, status='yes')]},
                   {'assessments': [dict(row, evidence=[{'segmentId': 'bad', 'quote': 'tien euro'}])]},
                   {'assessments': [dict(row, evidence=[{'segmentId': 's1', 'quote': 'TIEN EURO'}])]},
                   {'assessments': [dict(row, evidence=[{'segmentId': 's1', 'quote': ''}])]}]
        for item in invalid:
            with self.subTest(item=item), self.assertRaises(ValueError):
                vc.validate_response(item, data)
        self.assertEqual(vc.validate_response({'assessments': [dict(row, evidence=[])]}, data)['assessments'][0]['status'], 'uncertain')


class ModelPortTests(unittest.TestCase):
    def test_injected_config_port_and_safe_failures(self):
        from src import veneta_checklist as vc
        self.assertTrue(callable(getattr(vc, 'evaluate', None)), 'evaluation port missing')
        from unittest import mock
        config = mock.Mock()
        config.get_ai_provider.return_value = 'local'
        config.get_model.return_value = 'fixture-model'
        port = mock.Mock(return_value='{"assessments": []}')
        result = vc.evaluate(request(), config=config, model_port=port)
        self.assertNotIn('error', result)
        self.assertEqual(result['revision'], 'r1')
        self.assertEqual(result['assessments'][0]['status'], 'uncertain')
        kwargs = port.call_args.kwargs
        self.assertEqual(kwargs['model'], 'fixture-model')
        self.assertEqual(kwargs['options']['temperature'], 0)
        self.assertIsInstance(kwargs['format'], dict)
        self.assertFalse(kwargs['stream'])
        self.assertNotIn('tools', kwargs)
        self.assertIn('untrusted', kwargs['messages'][0]['content'])
        for provider in ('cloud', 'remote', 'adapter', 'invalid'):
            config.get_ai_provider.return_value = provider
            port.reset_mock()
            self.assertIn('error', vc.evaluate(request(), config=config, model_port=port))
            port.assert_not_called()
        config.get_ai_provider.return_value = 'local'
        for model in ('x:cloud', 'gpt-oss:120b-cloud', '', 'https://bad'):
            config.get_model.return_value = model
            port.reset_mock()
            self.assertIn('error', vc.evaluate(request(), config=config, model_port=port))
            port.assert_not_called()
        config.get_model.return_value = 'fixture-model'
        for reply in ('secret-private-text', '{"assessments": [], "path":"secret"}',
                      '{"assessments": [], "assessments": []}', 'x' * 128001):
            port.side_effect = None
            port.return_value = reply
            result = vc.evaluate(request(), config=config, model_port=port)
            self.assertIn('error', result)
            self.assertNotIn('secret', json.dumps(result))
        port.side_effect = RuntimeError('credentials and usertext secret')
        result = vc.evaluate(request(), config=config, model_port=port)
        self.assertIn('error', result)
        self.assertNotIn('secret', json.dumps(result))
        self.assertLess(len(result['error']), 200)
        self.assertEqual(result['revision'], 'r1')
        self.assertEqual(result['assessments'], [])

    def test_sdk_uses_config_runtime_tag_without_touching_configuration(self):
        from src import veneta_checklist as vc
        from src.veneta_checklist import OllamaModelPort
        from unittest import mock
        import ollama
        with FakeHTTP(local_tags('fixture-runtime')) as server, \
                mock.patch('src.config.resolve_runtime_tag', return_value='fixture-runtime') as resolve, \
                mock.patch('ollama.Client.chat', return_value=mock.Mock(
                    message=mock.Mock(content='{"assessments": []}'))) as chat, \
                mock.patch('ollama.Client', wraps=ollama.Client) as client:
            port = OllamaModelPort(server.endpoint)
            port(model='fixture-canonical', messages=[], stream=False)
        resolve.assert_called_once_with('fixture-canonical')
        self.assertEqual(chat.call_args.kwargs['model'], 'fixture-runtime')
        self.assertFalse(client.call_args.kwargs['trust_env'])
        self.assertFalse(client.call_args.kwargs['follow_redirects'])
        self.assertEqual(client.call_args.kwargs['timeout'], vc.CHAT_TIMEOUT_SECONDS)

    def test_local_mlx_safetensors_model_is_accepted(self):
        from src import veneta_checklist as vc
        from src.veneta_checklist import OllamaModelPort
        from unittest import mock
        # Apple Silicon resolves the default to an nvfp4 MLX tag that Ollama reports as
        # format 'safetensors' (real 0.31.1 metadata shape, synthetic values).
        tags = {'models': [{'name': 'fixture-mlx', 'model': 'fixture-mlx', 'size': 123,
                            'digest': 'b' * 64,
                            'details': {'format': 'safetensors', 'quantization_level': 'nvfp4'}}]}
        with FakeHTTP(tags) as server, \
                mock.patch('src.config.resolve_runtime_tag', return_value='fixture-mlx'), \
                mock.patch('ollama.Client.chat', return_value=mock.Mock(
                    message=mock.Mock(content='{"assessments": []}'))) as chat:
            OllamaModelPort(server.endpoint)(model='fixture-canonical', messages=[], stream=False)
        self.assertEqual(chat.call_args.kwargs['model'], 'fixture-mlx')

    def test_unknown_or_remote_format_stays_refused(self):
        from src import veneta_checklist as vc
        from src.veneta_checklist import OllamaModelPort
        from unittest import mock
        for details, extra in (({'format': 'unknown'}, {}), ({}, {}),
                               ({'format': 'safetensors'}, {'remote_host': 'https://x'}),
                               ({'format': 'safetensors'}, {'remote_model': 'x'})):
            row = {'name': 'fixture-x', 'model': 'fixture-x', 'size': 123,
                   'digest': 'c' * 64, 'details': details, **extra}
            with self.subTest(details=details, extra=extra), FakeHTTP({'models': [row]}) as server, \
                    mock.patch('src.config.resolve_runtime_tag', return_value='fixture-x'), \
                    mock.patch('ollama.Client.chat') as chat:
                with self.assertRaises(vc.ChecklistError) as caught:
                    OllamaModelPort(server.endpoint)(model='fixture-canonical', messages=[], stream=False)
                self.assertEqual(caught.exception.reason, 'model_not_local')
                chat.assert_not_called()


def local_tags(model='fixture-model'):
    """SYNTHETIC manifest only: no real model, weights or service required."""
    return {'models': [{'name': model, 'model': model, 'size': 123,
                        'digest': 'a' * 64, 'details': {'format': 'gguf'}}]}


class FakeHTTP:
    """Owned loopback metadata/chat service; records every request and payload."""
    def __init__(self, tags=None, *, raw=None, status=200, headers=None):
        self.tags = local_tags() if tags is None else tags
        self.raw, self.status, self.headers = raw, status, headers or {}
        self.calls = []

    def __enter__(self):
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        from threading import Thread
        owner = self
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                owner.calls.append((self.command, self.path, dict(self.headers), b''))
                body = owner.raw if owner.raw is not None else json.dumps(owner.tags).encode()
                self.send_response(owner.status)
                for key, value in owner.headers.items():
                    self.send_header(key, value)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            def do_POST(self):
                body = self.rfile.read(int(self.headers['Content-Length']))
                owner.calls.append((self.command, self.path, dict(self.headers), body))
                content = json.dumps({'message': {'role': 'assistant',
                                     'content': '{"assessments": []}'}, 'done': True}).encode()
                self.send_response(200)
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            def log_message(self, format, *args):
                pass
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.endpoint = f'http://127.0.0.1:{self.server.server_port}'
        return self

    def __exit__(self, *args):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)


class TransportTests(unittest.TestCase):
    def test_neutral_alias_cloud_metadata_never_receives_transcript(self):
        from src import veneta_checklist as vc
        from unittest import mock
        tags = local_tags()
        tags['models'][0].update(remote_model='remote-private-model', remote_host='https://ollama.com')
        config = mock.Mock()
        config.get_ai_provider.return_value = 'local'
        config.get_model.return_value = 'fixture-model'
        with FakeHTTP(tags) as server:
            result = vc.evaluate(request(), config=config, model_port=vc.OllamaModelPort(server.endpoint))
        self.assertEqual([c[:2] for c in server.calls], [('GET', '/api/tags')])
        self.assertFalse(any(c[0] == 'POST' for c in server.calls))
        self.assertNotIn(request()['segments'][0]['text'], repr(server.calls))
        self.assertIn('error', result)

    def test_invalid_local_manifests_fail_closed(self):
        from src import veneta_checklist as vc
        from unittest import mock
        valid = local_tags()['models'][0]
        cases = [('missing', {}), ('empty', {'models': []}),
                 ('duplicate', {'models': [valid, valid]}),
                 ('mismatched-name', {'models': [dict(valid, name='other')]}),
                 ('mismatched-model', {'models': [dict(valid, model='other')]}),
                 ('invalid-row', {'models': [valid, None]})]
        for field, values in (
            ('size', (None, False, 0, -1, '123', 1.5)),
            ('digest', ('', 'a' * 63, 'z' * 64, 'sha256:bad', None)),
            ('details', (None, {}, {'format': ''}, {'format': 'GGUF'}, {'format': 'SafeTensors'}, {'format': 'mlx'})),
            ('remote_host', ('https://ollama.com', '', None)),
            ('remote_model', ('neutral-alias', '', None)),
        ):
            for value in values:
                cases.append((f'{field}={value!r}', {'models': [dict(valid, **{field: value})]}))
        for field in ('size', 'digest', 'details', 'name'):
            row = dict(valid)
            del row[field]
            cases.append((f'absent-{field}', {'models': [row]}))
        config = mock.Mock()
        config.get_ai_provider.return_value = 'local'
        config.get_model.return_value = 'fixture-model'
        for label, tags in cases:
            with self.subTest(case=label), FakeHTTP(tags) as server:
                result = vc.evaluate(request(), config=config, model_port=vc.OllamaModelPort(server.endpoint))
                self.assertIn('error', result)
                self.assertEqual([c[:2] for c in server.calls], [('GET', '/api/tags')])
                self.assertNotIn(request()['segments'][0]['text'], repr(server.calls))

    def test_metadata_bad_bodies_and_redirects_fail_closed(self):
        from src import veneta_checklist as vc
        from unittest import mock
        config = mock.Mock()
        config.get_ai_provider.return_value = 'local'
        config.get_model.return_value = 'fixture-model'
        valid = json.dumps(local_tags()).encode()
        cases = [dict(raw=b'{broken'), dict(raw=b'\xff'), dict(raw=b'{"models":[],"models":[]}'),
                 dict(raw=b'{"models":[],"x":NaN}'), dict(raw=b'[]'),
                 dict(raw=valid + b' ' * 262144), dict(raw=valid, status=500),
                 dict(raw=valid, status=302, headers={'Location': 'http://192.0.2.1:9/blocked'})]
        for case in cases:
            with self.subTest(case=str(case)[:80]), FakeHTTP(**case) as server, \
                    mock.patch.dict(os.environ, {'HTTP_PROXY': 'http://192.0.2.1:9',
                                                 'HTTPS_PROXY': 'http://192.0.2.1:9', 'ALL_PROXY': 'http://192.0.2.1:9',
                                                 'NO_PROXY': '', 'OLLAMA_API_KEY': 'never-send-secret'}):
                result = vc.evaluate(request(), config=config, model_port=vc.OllamaModelPort(server.endpoint))
                self.assertIn('error', result)
                self.assertEqual([c[:2] for c in server.calls], [('GET', '/api/tags')])
                self.assertEqual({k.lower(): v for k, v in server.calls[0][2].items()}['authorization'],
                                 'Bearer local-only')
                self.assertNotIn('never-send-secret', repr(server.calls))

    def test_malformed_model_id_is_not_normalized_by_runtime_resolver(self):
        from src.veneta_checklist import OllamaModelPort
        from unittest import mock
        for model in (' fixture-model', 'fixture-model ', 'fixture-model:', 'a//fixture-model', '../fixture-model'):
            with self.subTest(model=model), FakeHTTP() as server, \
                    mock.patch('src.config.resolve_runtime_tag', return_value='fixture-model') as resolve:
                with self.assertRaises(ValueError):
                    OllamaModelPort(server.endpoint)(model=model, messages=[], stream=False)
                self.assertEqual(server.calls, [])
                resolve.assert_not_called()

    def test_metadata_stream_limit_and_read_timeout(self):
        from src import veneta_checklist as vc
        from unittest import mock
        import httpx
        consumed = []
        class Chunks(httpx.SyncByteStream):
            def __iter__(self):
                for _ in range(100):
                    consumed.append(1)
                    yield b' ' * 8192
        real_client = httpx.Client
        def make_client(**kwargs):
            self.assertEqual(kwargs['timeout'], 30)
            self.assertFalse(kwargs['trust_env'])
            self.assertFalse(kwargs['follow_redirects'])
            return real_client(**kwargs, transport=httpx.MockTransport(
                lambda req: httpx.Response(200, stream=Chunks())))
        with mock.patch('httpx.Client', side_effect=make_client), mock.patch('ollama.Client.chat') as chat:
            with self.assertRaises(ValueError):
                vc.OllamaModelPort('http://127.0.0.1:9')(model='fixture-model', messages=[])
        self.assertLessEqual(len(consumed), 33)
        chat.assert_not_called()

    def test_drip_metadata_checks_deadline_without_waiting_for_full_chunk(self):
        from src import veneta_checklist as vc
        from unittest import mock
        import httpx
        clock, consumed = [0.0], []
        class Drip(httpx.SyncByteStream):
            def __iter__(self):
                for _ in range(100):
                    clock[0] += 1
                    consumed.append(1)
                    yield b' '
        real_client = httpx.Client
        def make_client(**kwargs):
            return real_client(**kwargs, transport=httpx.MockTransport(
                lambda req: httpx.Response(200, stream=Drip())))
        with mock.patch('httpx.Client', side_effect=make_client), \
                mock.patch('time.monotonic', side_effect=lambda: clock[0]), \
                mock.patch('ollama.Client.chat') as chat:
            with self.assertRaises(ValueError):
                vc.OllamaModelPort('http://127.0.0.1:9')(model='fixture-model', messages=[])
        self.assertLessEqual(len(consumed), 30)
        chat.assert_not_called()

    def test_loopback_endpoint_validation(self):
        from src import veneta_checklist as vc
        self.assertTrue(callable(getattr(vc, 'validate_endpoint', None)), 'loopback endpoint guard missing')
        for url in ('http://127.0.0.1:11434', 'http://[::1]:1234', 'http://localhost:1234'):
            self.assertTrue(vc.validate_endpoint(url).startswith('http://'))
        for url in ('https://example.com', 'http://192.168.1.1', 'http://127.0.0.1.evil',
                    'http://user:secret@127.0.0.1', 'http://127.0.0.1/a',
                    'http://127.0.0.1?x=1', 'http://127.0.0.1#x', 'file:///etc/passwd',
                    '127.0.0.1:11434', 'http://127.0.0.1:99999'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                vc.validate_endpoint(url)

    def test_sdk_does_not_follow_external_redirect_or_echo_provider_body(self):
        from src import veneta_checklist as vc
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        from threading import Thread
        from unittest import mock
        import socket
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                content = json.dumps(local_tags()).encode()
                self.send_response(200)
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            def do_POST(self):
                body = b'private-provider-response-secret'
                self.send_response(302)
                self.send_header('Location', 'http://192.0.2.1:9/never-contact')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            def log_message(self, format, *args):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        attempts = []
        original_connect = socket.socket.connect
        def owned_connect(sock, address):
            attempts.append(address)
            if address != ('127.0.0.1', server.server_port):
                raise AssertionError('Test blocked a non-owned network connection')
            return original_connect(sock, address)
        config = mock.Mock()
        config.get_ai_provider.return_value = 'local'
        config.get_model.return_value = 'fixture-model'
        try:
            port = vc.OllamaModelPort(f'http://127.0.0.1:{server.server_port}')
            with mock.patch('socket.socket.connect', owned_connect):
                result = vc.evaluate(request(), config=config, model_port=port)
            self.assertEqual(attempts, [('127.0.0.1', server.server_port)] * 2)
            self.assertEqual(result['revision'], 'r1')
            self.assertEqual(result['assessments'], [])
            self.assertIn('error', result)
            self.assertNotIn('secret', json.dumps(result))
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_real_sdk_owned_http_wire_without_model(self):
        from src import veneta_checklist as vc
        self.assertTrue(callable(getattr(vc, 'OllamaModelPort', None)), 'SDK transport missing')
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        from threading import Thread
        from unittest import mock
        captured = []
        metadata = []
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                metadata.append((self.path, dict(self.headers)))
                content = json.dumps(local_tags()).encode()
                self.send_response(200)
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            def do_POST(self):
                captured.append((self.path, dict(self.headers), json.loads(self.rfile.read(int(self.headers['Content-Length'])))))
                content = json.dumps({'message': {'role': 'assistant', 'content': json.dumps({
                    'assessments': [{'criterionId': 'c1', 'status': 'covered',
                                     'evidence': [{'segmentId': 's1', 'quote': 'tien euro'}],
                                     'explanation': 'Prijs toegelicht.'}]})}, 'done': True}).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            def log_message(self, format, *args):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        config = mock.Mock()
        config.get_ai_provider.return_value = 'local'
        config.get_model.return_value = 'fixture-model'
        try:
            with mock.patch.dict(os.environ, {'OLLAMA_API_KEY': 'never-send-secret',
                                              'HTTP_PROXY': 'http://invalid.example:9999'}):
                port = vc.OllamaModelPort(f'http://127.0.0.1:{server.server_port}')
                result = vc.evaluate(request(), config=config, model_port=port)
            self.assertNotIn('error', result)
            self.assertEqual(result['assessments'][0]['status'], 'covered')
            self.assertEqual(len(captured), 1)
            path, headers, body = captured[0]
            self.assertEqual(path, '/api/chat')
            self.assertNotIn('never-send-secret', json.dumps(headers))
            self.assertEqual(body['model'], 'fixture-model')
            self.assertIsInstance(body['format'], dict)
            self.assertEqual(body['options']['temperature'], 0)
            self.assertFalse(body['stream'])
            # Exercise the real CLI process and SDK against this owned server too.
            import subprocess
            import sys
            with tempfile.TemporaryDirectory(dir=SCRATCH, prefix='checklist-wire-cli-') as tmp:
                root = Path(tmp)
                (root / 'config.json').write_text(json.dumps({'ai_provider': 'local', 'model': 'fixture-model'}))
                source = root / 'request.json'
                source.write_text(json.dumps(request()))
                source.chmod(0o600)
                before = {p.name: p.read_bytes() for p in root.iterdir()}
                process = subprocess.run([sys.executable, 'simple_recorder.py', 'checklist-evaluate', str(source)],
                    cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True, timeout=15,
                    env=dict(os.environ, STENOAI_USER_DATA_DIR=tmp, TMPDIR=str(SCRATCH),
                             OLLAMA_HOST=f'http://127.0.0.1:{server.server_port}',
                             OLLAMA_API_KEY='never-send-secret', HTTP_PROXY='http://invalid.example:9999'))
                self.assertEqual(process.returncode, 0, process.stderr)
                self.assertEqual(json.loads(process.stdout)['assessments'][0]['status'], 'covered')
                self.assertEqual(before, {p.name: p.read_bytes() for p in root.iterdir()})
                self.assertNotIn('tien euro', process.stderr)
                self.assertNotIn('never-send-secret', process.stderr)
                self.assertEqual(len(captured), 2)
                self.assertEqual([entry[0] for entry in metadata], ['/api/tags', '/api/tags'])
                self.assertNotIn('never-send-secret', repr(metadata))
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


class CliTests(unittest.TestCase):
    def _assert_malformed_config_preserved(self, content):
        from unittest import mock
        from click.testing import CliRunner
        with tempfile.TemporaryDirectory(dir=SCRATCH, prefix='checklist-config-preserve-') as tmp:
            root = Path(tmp)
            (root / 'config.json').write_bytes(content)
            source = root / 'request.json'
            source.write_text(json.dumps(request()))
            source.chmod(0o600)
            (root / 'canonical.txt').write_bytes(b'synthetic unchanged transcript')
            before = {p.name: p.read_bytes() for p in root.iterdir()}
            with mock.patch.dict(os.environ, {'STENOAI_USER_DATA_DIR': tmp,
                                              'OLLAMA_HOST': 'http://127.0.0.1:11434'}):
                import simple_recorder
                with mock.patch('src.config.Config.__init__', side_effect=AssertionError('migration forbidden')) as constructor, \
                        mock.patch('ollama.Client.chat') as transport:
                    result = CliRunner().invoke(simple_recorder.cli, ['checklist-evaluate', str(source)])
            constructor.assert_not_called()
            self.assertEqual(result.exit_code, 1, result.output)
            self.assertEqual(json.loads(result.output)['revision'], 'r1')
            self.assertIn('error', json.loads(result.output))
            transport.assert_not_called()
            self.assertEqual(before, {p.name: p.read_bytes() for p in root.iterdir()})

    def test_cli_preserves_broken_json_config_without_model_calls(self):
        self._assert_malformed_config_preserved(b'{broken synthetic config\n')

    def test_cli_preserves_duplicate_key_config_without_model_calls(self):
        self._assert_malformed_config_preserved(
            b'{"ai_provider":"local","model":"first","model":"second"}\n')

    def test_cli_preserves_null_model_config_without_model_calls(self):
        self._assert_malformed_config_preserved(b'{"ai_provider":"local","model":null}\n')

    def test_cli_preserves_invalid_provider_config_without_model_calls(self):
        self._assert_malformed_config_preserved(b'{"ai_provider":"invalid","model":"fixture-model"}\n')

    def test_cli_reads_real_private_request_and_config_without_writes(self):
        from unittest import mock
        from click.testing import CliRunner
        with tempfile.TemporaryDirectory(dir=SCRATCH, prefix='checklist-cli-') as tmp, FakeHTTP() as server:
            with mock.patch.dict(os.environ, {'STENOAI_USER_DATA_DIR': tmp,
                                              'OLLAMA_HOST': server.endpoint}):
                import simple_recorder
                self.assertIn('checklist-evaluate', simple_recorder.cli.commands, 'CLI command missing')
                root = Path(tmp)
                config_path = root / 'config.json'
                config_path.write_text(json.dumps({'ai_provider': 'local', 'model': 'fixture-model',
                                                  'whisper_model': 'legacy-stays-unchanged'}))
                source = root / 'request.json'
                source.write_text(json.dumps(request()))
                source.chmod(0o600)
                canonical = root / 'transcripts' / 'untouched.txt'
                canonical.parent.mkdir()
                canonical.write_text('synthetic canonical transcript')
                before = {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}
                with mock.patch('ollama.Client.chat', return_value=mock.Mock(
                        message=mock.Mock(content='{"assessments": []}'))) as transport:
                    result = CliRunner().invoke(simple_recorder.cli, ['checklist-evaluate', str(source)])
                self.assertEqual(result.exit_code, 0, result.output)
                self.assertEqual(json.loads(result.output)['revision'], 'r1')
                self.assertEqual(transport.call_args.kwargs['model'], 'fixture-model')
                self.assertEqual(before, {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()})
                with mock.patch('ollama.Client.chat', side_effect=RuntimeError('secret usertext provider body')):
                    failed = CliRunner().invoke(simple_recorder.cli, ['checklist-evaluate', str(source)])
                self.assertEqual(failed.exit_code, 1)
                self.assertEqual(json.loads(failed.output), {
                    'revision': 'r1', 'assessments': [],
                    'error': 'Lokale checklistbeoordeling niet beschikbaar of ongeldig antwoord.',
                    'reason': 'failed'})
                self.assertNotIn('secret', failed.output)
                for provider in ('cloud', 'remote', 'adapter', 'bad-provider'):
                    config_path.write_text(json.dumps({'ai_provider': provider, 'model': 'fixture-model'}))
                    with mock.patch('ollama.Client.chat') as transport:
                        result = CliRunner().invoke(simple_recorder.cli, ['checklist-evaluate', str(source)])
                    self.assertNotEqual(result.exit_code, 0)
                    self.assertIn('error', json.loads(result.output))
                    transport.assert_not_called()
                help_result = CliRunner().invoke(simple_recorder.cli, ['--help'])
                self.assertEqual(help_result.exit_code, 0)
                for command in ('status', 'query', 'process-streaming', 'checklist-evaluate'):
                    self.assertIn(command, help_result.output)

    def test_cli_rejects_malformed_oversized_nonprivate_and_external_files(self):
        from unittest import mock
        from click.testing import CliRunner
        with tempfile.TemporaryDirectory(dir=SCRATCH, prefix='checklist-bad-') as tmp:
            root = Path(tmp)
            userdata = root / 'userdata'
            userdata.mkdir()
            with mock.patch.dict(os.environ, {'STENOAI_USER_DATA_DIR': str(userdata)}):
                import simple_recorder
                self.assertIn('checklist-evaluate', simple_recorder.cli.commands, 'CLI command missing')
                source = userdata / 'request.json'
                for content in ('{"revision":"secret", "revision":"forged"}', 'NaN',
                                '{broken secret', 'x' * 256001, json.dumps(dict(request(), url='http://evil'))):
                    source.write_text(content)
                    source.chmod(0o600)
                    with mock.patch('ollama.Client.chat') as transport:
                        result = CliRunner().invoke(simple_recorder.cli, ['checklist-evaluate', str(source)])
                    self.assertNotEqual(result.exit_code, 0)
                    self.assertIn('error', json.loads(result.output))
                    self.assertNotIn('secret', result.output)
                    transport.assert_not_called()
                external = root / 'outside.json'
                external.write_text(json.dumps(request()))
                external.chmod(0o600)
                paths = [external, userdata, userdata / 'missing.json']
                link = userdata / 'symlink.json'
                try:
                    link.symlink_to(external)
                except OSError:
                    if os.name != 'nt':
                        raise
                else:
                    paths.append(link)
                source.write_text(json.dumps(request()))
                source.chmod(0o644)
                if os.name != 'nt':
                    paths.append(source)
                for path in paths:
                    result = CliRunner().invoke(simple_recorder.cli, ['checklist-evaluate', str(path)])
                    self.assertNotEqual(result.exit_code, 0, str(path))
                    self.assertIn('error', json.loads(result.output))


if __name__ == '__main__':
    unittest.main()
