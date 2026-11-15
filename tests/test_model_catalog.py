"""Catalogue schema, model-name validation, installed-model discovery and size lookup.

Everything runs against owned loopback stubs or pure functions: no Ollama, no model and no
network. The shipped catalogue is data that the app trusts, so it is validated here.
"""
import copy
import json
import socket
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from src import model_catalog as mc


class Stub:
    """Loopback server answering GET with scripted (status, body) per path; records requests."""

    def __init__(self, routes):
        self.routes, self.requests = routes, []

    def __enter__(self):
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                owner.requests.append((self.command, self.path, dict(self.headers)))
                status, body = owner.routes.get(self.path, (404, b'{}'))
                if not isinstance(body, bytes):
                    body = json.dumps(body).encode()
                self.send_response(status)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                owner.requests.append((self.command, self.path, dict(self.headers)))
                self.send_response(405)
                self.send_header('Content-Length', '0')
                self.end_headers()

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'
        return self

    def __exit__(self, *args):
        self.server.shutdown()
        self.server.server_close()


def closed_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class NameValidation(unittest.TestCase):
    def test_accepts_ollama_names_and_hugging_face_references(self):
        for name, kind in [('gemma4:e2b-it-qat', 'ollama'), ('llama3.2:3b', 'ollama'),
                           ('nemotron-3-nano:4b', 'ollama'), ('gemma4', 'ollama'),
                           ('someone/custom-model:q4_K_M', 'ollama'),
                           ('hf.co/nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-4GB:Q4_K_M', 'hf'),
                           ('hf.co/org/repo', 'hf')]:
            with self.subTest(name=name):
                self.assertEqual(mc.validate_model_name(name)['kind'], kind)

    def test_normalises_surrounding_whitespace_only(self):
        self.assertEqual(mc.validate_model_name('  gemma4:e4b-it-qat \n')['name'], 'gemma4:e4b-it-qat')

    def test_rejects_cloud_and_remote_references_with_their_own_reason(self):
        for name in ['gemma4:31b-cloud', 'gpt-oss:20b-cloud', 'gemma4:cloud', 'x:cloud',
                     'hf.co/org/repo-cloud', 'nemotron-3-nano:30b-CLOUD']:
            with self.subTest(name=name), self.assertRaises(mc.ModelNameError) as ctx:
                mc.validate_model_name(name)
            self.assertEqual(ctx.exception.reason, 'cloud')

    def test_cloud_is_matched_per_segment_not_as_substring(self):
        self.assertEqual(mc.validate_model_name('cloudy-model:7b')['kind'], 'ollama')
        self.assertFalse(mc.is_cloud_name('hf.co/org/Cloudless-8B:Q4_K_M'))
        self.assertTrue(mc.is_cloud_name('model:7b-cloud'))

    def test_rejects_malformed_names(self):
        for name in ['', '   ', 'a b', '../x', 'x:y:z', 'hf.co/onlyorg', 'hf.co/o/r/extra', 'hf.co/o/r:q:x',
                     'http://evil.example/x', 'https://hf.co/o/r', 'model\nname', '-bad', 'a:', ':b',
                     'x' * 201, 'name;rm', 'name$(x)', 'huggingface.co/o/r', None, 5]:
            with self.subTest(name=repr(name)), self.assertRaises(mc.ModelNameError):
                mc.validate_model_name(name)

    def test_length_boundary_is_200(self):
        self.assertEqual(mc.validate_model_name('a' * 200)['name'], 'a' * 200)
        with self.assertRaises(mc.ModelNameError) as ctx:
            mc.validate_model_name('a' * 201)
        self.assertEqual(ctx.exception.reason, 'too_long')


class CatalogSchema(unittest.TestCase):
    def setUp(self):
        self.shipped = mc.load_catalog()

    def models(self):
        return {entry['id']: entry for entry in self.shipped['models']}

    def test_shipped_catalogue_has_the_required_gemma_and_nemotron_entries(self):
        models = self.models()
        for key, size_class in [('gemma4-e2b', 'klein'), ('gemma4-e4b', 'mac'), ('gemma4-12b', 'mac')]:
            self.assertEqual(models[key]['status'], 'aanbevolen', key)
            self.assertEqual(models[key]['device_class'], size_class, key)
        bolt = models['nemotron-3-5-bolt-e4b']
        self.assertEqual((bolt['status'], bolt['device_class']), ('kandidaat', 'klein'))
        self.assertEqual(bolt['hf_repo'], 'nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-4GB')
        lightning = models['nemotron-3-5-lightning-30b-a3b']
        self.assertEqual((lightning['status'], lightning['device_class']), ('kandidaat', 'mac'))
        self.assertEqual(lightning['ollama_tags'], {}, 'no Ollama tag is invented for an unconfirmed model')
        nano = models['nemotron-3-nano-4b']
        self.assertEqual((nano['status'], nano['device_class']), ('kandidaat', 'klein'))
        self.assertEqual(nano['ollama_tags']['gguf'], 'nemotron-3-nano:4b')

    def test_every_candidate_is_marked_unmeasured_and_never_recommended(self):
        for entry in self.shipped['models']:
            if entry['id'].startswith('nemotron'):
                self.assertEqual(entry['status'], 'kandidaat', entry['id'])

    def test_every_tag_passes_the_same_name_validation_as_user_input(self):
        for entry in self.shipped['models']:
            for tag in entry['ollama_tags'].values():
                mc.validate_model_name(tag)

    def test_sources_are_https_and_entries_carry_a_licence(self):
        for entry in self.shipped['models']:
            self.assertTrue(entry['source_url'].startswith('https://'), entry['id'])
            self.assertTrue(entry['license'].strip(), entry['id'])
            self.assertNotIn('\u2014', json.dumps(entry, ensure_ascii=False), entry['id'])

    def test_validation_rejects_each_schema_violation(self):
        def mutate(change):
            data = copy.deepcopy(self.shipped)
            change(data)
            return data
        bad = {
            'schema version': lambda d: d.update(schema_version=2),
            'no models': lambda d: d.update(models=[]),
            'duplicate id': lambda d: d['models'].append(copy.deepcopy(d['models'][0])),
            'unknown status': lambda d: d['models'][0].update(status='beste'),
            'unknown class': lambda d: d['models'][0].update(device_class='ipad'),
            'unknown function': lambda d: d['models'][0].update(functions=['transcribe']),
            'empty functions': lambda d: d['models'][0].update(functions=[]),
            'cloud tag': lambda d: d['models'][0]['ollama_tags'].update(gguf='gemma4:31b-cloud'),
            'unknown tag kind': lambda d: d['models'][0]['ollama_tags'].update(int8='x:1'),
            'http source': lambda d: d['models'][0].update(source_url='http://example.org/x'),
            'negative size': lambda d: d['models'][0].update(size_bytes=-1),
            'bool size': lambda d: d['models'][0].update(size_bytes=True),
            'extra field': lambda d: d['models'][0].update(rating=5),
            'missing field': lambda d: d['models'][0].pop('license'),
            'bad id': lambda d: d['models'][0].update(id='Has Space'),
            'not a dict': lambda d: d['models'].append('gemma'),
        }
        for label, change in bad.items():
            with self.subTest(label), self.assertRaises(mc.CatalogError):
                mc.validate_catalog(mutate(change))

    def test_unreadable_or_invalid_file_is_a_catalog_error(self):
        import os
        import tempfile
        with tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR')) as tmp:
            path = os.path.join(tmp, 'catalog.json')
            with self.assertRaises(mc.CatalogError):
                mc.load_catalog(path)
            with open(path, 'w') as handle:
                handle.write('{"schema_version": 1, "models": [}')
            with self.assertRaises(mc.CatalogError):
                mc.load_catalog(path)


def tags_row(name, **overrides):
    row = {'name': name, 'model': name, 'size': 4_300_000_000, 'digest': 'a' * 64,
           'details': {'format': 'gguf', 'quantization_level': 'Q4_K_M', 'family': 'gemma4',
                       'parameter_size': '4B'},
           'capabilities': ['completion']}
    row.update(overrides)
    return row


class InstalledRows(unittest.TestCase):
    def test_parse_keeps_name_size_format_and_quantisation(self):
        rows = mc.parse_tags({'models': [
            tags_row('gemma4:e2b-it-qat'),
            tags_row('gemma4:e2b-nvfp4', details={'format': 'safetensors', 'quantization_level': 'nvfp4'}),
        ]})
        self.assertEqual([r['name'] for r in rows], ['gemma4:e2b-it-qat', 'gemma4:e2b-nvfp4'])
        self.assertEqual((rows[0]['format'], rows[0]['quantization'], rows[0]['size_bytes']),
                         ('gguf', 'Q4_K_M', 4_300_000_000))
        self.assertEqual((rows[1]['format'], rows[1]['quantization']), ('safetensors', 'nvfp4'))
        self.assertTrue(all(r['local'] for r in rows))

    def test_remote_cloud_and_unknown_format_rows_are_not_local(self):
        rows = {r['name']: r for r in mc.parse_tags({'models': [
            tags_row('far:1', remote_host='https://ollama.com'),
            tags_row('far:2', remote_model='x'),
            tags_row('gemma4:31b-cloud'),
            tags_row('odd:1', details={'format': 'onnx'}),
            tags_row('nodetails:1', details=None),
            tags_row('nosize:1', size=0),
            tags_row('good:1'),
        ]})}
        self.assertTrue(rows['good:1']['local'])
        for name in ['far:1', 'far:2', 'gemma4:31b-cloud', 'odd:1', 'nodetails:1', 'nosize:1']:
            self.assertFalse(rows[name]['local'], name)

    def test_malformed_payload_gives_no_rows(self):
        for payload in [None, [], {}, {'models': 'x'}, {'models': [1, 'a']}]:
            self.assertEqual(mc.parse_tags(payload), [], repr(payload))

    def test_read_installed_issues_one_get_and_nothing_else(self):
        with Stub({'/api/tags': (200, {'models': [tags_row('gemma4:e2b-it-qat')]})}) as stub:
            result = mc.read_installed(stub.base)
        self.assertTrue(result['running'])
        self.assertEqual([r['name'] for r in result['models']], ['gemma4:e2b-it-qat'])
        self.assertEqual([(m, p) for m, p, _ in stub.requests], [('GET', '/api/tags')])

    def test_unreachable_server_is_reported_not_started(self):
        result = mc.read_installed(f'http://127.0.0.1:{closed_port()}', timeout=2)
        self.assertEqual(result, {'running': False, 'models': []})

    def test_non_loopback_endpoint_is_refused_without_a_request(self):
        result = mc.read_installed('http://192.0.2.1:11434', timeout=1)
        self.assertEqual(result, {'running': False, 'models': []})

    def test_error_status_and_garbage_are_not_running(self):
        for route in [(500, b'{}'), (200, b'not json'), (200, b'[]')]:
            with Stub({'/api/tags': route}) as stub:
                result = mc.read_installed(stub.base)
            self.assertEqual(result['models'], [], route)


class SizeLookup(unittest.TestCase):
    BASES = {'registry': 'https://registry.example', 'hf': 'https://hf.example'}

    def test_manifest_urls_follow_the_registry_layout(self):
        cases = {
            'gemma4:e2b-it-qat': 'https://registry.example/v2/library/gemma4/manifests/e2b-it-qat',
            'gemma4': 'https://registry.example/v2/library/gemma4/manifests/latest',
            'someone/custom:q4': 'https://registry.example/v2/someone/custom/manifests/q4',
            'hf.co/nvidia/Repo-1:Q4_K_M': 'https://hf.example/v2/nvidia/Repo-1/manifests/Q4_K_M',
            'hf.co/org/repo': 'https://hf.example/v2/org/repo/manifests/latest',
        }
        for name, url in cases.items():
            self.assertEqual(mc.manifest_url(name, self.BASES), url, name)

    def test_default_bases_are_https(self):
        self.assertTrue(mc.manifest_url('gemma4:e2b-it-qat').startswith('https://'))
        self.assertTrue(mc.manifest_url('hf.co/o/r:Q4').startswith('https://'))

    def manifest(self, *sizes, config=100):
        return {'schemaVersion': 2, 'config': {'size': config}, 'layers': [{'size': s} for s in sizes]}

    def test_size_is_config_plus_layers_via_a_single_get(self):
        route = '/v2/library/gemma4/manifests/e2b-it-qat'
        with Stub({route: (200, self.manifest(1000, 2000, 30))}) as stub:
            size = mc.registry_size('gemma4:e2b-it-qat', {'registry': stub.base, 'hf': stub.base})
        self.assertEqual(size, 3130)
        self.assertEqual([(m, p) for m, p, _ in stub.requests], [('GET', route)])
        self.assertIn('manifest', stub.requests[0][2].get('Accept', ''))

    def test_hugging_face_reference_uses_the_hf_base(self):
        route = '/v2/org/repo/manifests/Q4_K_M'
        with Stub({route: (200, self.manifest(5000))}) as stub:
            size = mc.registry_size('hf.co/org/repo:Q4_K_M', {'registry': 'http://127.0.0.1:9', 'hf': stub.base})
        self.assertEqual(size, 5100)

    def test_unknown_size_is_none_never_a_guess(self):
        route = '/v2/library/x/manifests/latest'
        bad = [(404, b'{}'), (500, b'{}'), (200, b'garbage'), (200, b'[]'), (200, {'layers': []}),
               (200, {'config': {'size': 1}, 'layers': [{'size': 'big'}]}),
               (200, {'config': {'size': 1}, 'layers': [{'size': -5}]}),
               (200, {'config': {'size': 1}, 'layers': [{'size': True}]})]
        for response in bad:
            with Stub({route: response}) as stub:
                self.assertIsNone(mc.registry_size('x', {'registry': stub.base, 'hf': stub.base}), response)
        self.assertIsNone(mc.registry_size('x', {'registry': f'http://127.0.0.1:{closed_port()}', 'hf': ''}, timeout=2))

    def test_invalid_names_and_cloud_names_never_reach_the_network(self):
        with Stub({}) as stub:
            for name in ['', 'a b', 'gemma4:31b-cloud']:
                self.assertIsNone(mc.registry_size(name, {'registry': stub.base, 'hf': stub.base}))
        self.assertEqual(stub.requests, [])

    def test_oversized_manifest_is_not_trusted(self):
        route = '/v2/library/x/manifests/latest'
        with Stub({route: (200, b'{"layers": [' + b'{"size": 1},' * 200000 + b'{"size": 1}]}')}) as stub:
            self.assertIsNone(mc.registry_size('x', {'registry': stub.base, 'hf': stub.base}))


class DiskSpace(unittest.TestCase):
    GIB = 1024 ** 3

    def test_enough_space_with_margin(self):
        result = mc.check_disk_space(4 * self.GIB, free_bytes=20 * self.GIB)
        self.assertTrue(result['ok'])
        self.assertEqual(result['free_bytes'], 20 * self.GIB)

    def test_not_enough_space_names_the_need(self):
        result = mc.check_disk_space(4 * self.GIB, free_bytes=4 * self.GIB)
        self.assertFalse(result['ok'])
        self.assertGreater(result['needed_bytes'], 4 * self.GIB)

    def test_exact_fit_without_margin_is_refused(self):
        self.assertFalse(mc.check_disk_space(10 * self.GIB, free_bytes=10 * self.GIB)['ok'])

    def test_unknown_size_still_requires_a_minimum_free(self):
        self.assertTrue(mc.check_disk_space(None, free_bytes=3 * self.GIB)['ok'])
        self.assertFalse(mc.check_disk_space(None, free_bytes=self.GIB)['ok'])

    def test_real_path_probe_returns_integers(self):
        result = mc.check_disk_space(1)
        self.assertIsInstance(result['free_bytes'], int)


class InUse(unittest.TestCase):
    CHOICES = {'summary': 'gemma4:e2b-it-qat', 'summary_fold': 'gemma4:e2b-it-qat', 'checklist': 'qwen3.5:9b'}

    def test_lists_every_function_using_the_model(self):
        self.assertEqual(mc.functions_in_use('qwen3.5:9b', self.CHOICES, apple_silicon=False), ['checklist'])
        self.assertEqual(mc.functions_in_use('gemma4:e2b-it-qat', self.CHOICES, apple_silicon=False),
                         ['summary', 'summary_fold'])
        self.assertEqual(mc.functions_in_use('other:1', self.CHOICES, apple_silicon=False), [])

    def test_apple_silicon_resolves_to_the_nvfp4_runtime_tag(self):
        self.assertEqual(mc.functions_in_use('gemma4:e2b-nvfp4', self.CHOICES, apple_silicon=True),
                         ['summary', 'summary_fold'])
        # The gguf blob is no longer what runs, so removing it (faster-build flow) is allowed.
        self.assertEqual(mc.functions_in_use('gemma4:e2b-it-qat', self.CHOICES, apple_silicon=True), [])


if __name__ == '__main__':
    unittest.main()
