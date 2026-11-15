"""Robustness of the live checklist against the answer shapes the small local model gives.

Synthetic fixtures only (see tests/fixtures/checklist-local-model-recording.json). No Ollama
is started, no model is pulled; servers are loopback stubs and the start helper is faked.
"""
import json
import os
import socket
import stat
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

from tests.test_veneta_checklist import FakeHTTP, local_tags

SCRATCH = Path(os.environ.get('TMPDIR') or tempfile.gettempdir())
RECORDING = json.loads((Path(__file__).parent / 'fixtures' / 'checklist-local-model-recording.json').read_text())


def config():
    cfg = mock.Mock()
    cfg.get_ai_provider.return_value = 'local'
    cfg.get_model.return_value = 'fixture-model'
    return cfg


def run(*replies, request=None):
    """Evaluate with a scripted port; returns (result, port)."""
    from src import veneta_checklist as vc
    port = mock.Mock(side_effect=list(replies) if len(replies) > 1 else None,
                     return_value=replies[0] if len(replies) == 1 else None)
    return vc.evaluate(request or RECORDING['request'], config=config(), model_port=port), port


def by_id(result):
    return {a['criterionId']: a for a in result['assessments']}


class ModelAnswerShapes(unittest.TestCase):
    def test_clean_answer_keeps_three_levels_per_criterion(self):
        result, port = run(RECORDING['replies']['clean'])
        self.assertNotIn('error', result)
        rows = by_id(result)
        self.assertEqual((rows['c1']['status'], rows['c1']['kind'], rows['c1']['customerConfirmed']),
                         ('covered', 'explained', False))
        self.assertEqual((rows['c2']['kind'], rows['c2']['customerConfirmed']), ('explained', True))
        self.assertEqual(rows['c2']['customerEvidence'], [{'segmentId': 's4', 'quote': 'dat is akkoord voor ons'}])
        self.assertEqual((rows['c3']['status'], rows['c3']['kind']), ('unmentioned', 'none'))
        self.assertEqual(port.call_count, 1)

    def test_whole_answer_codeblock_is_unwrapped(self):
        for name in ('fenced', 'fenced_plain', 'think_then_fenced'):
            with self.subTest(name):
                result, port = run(RECORDING['replies'][name])
                self.assertNotIn('error', result, name)
                self.assertEqual(by_id(result)['c1']['status'], 'covered')
                self.assertEqual(port.call_count, 1)

    def test_prose_around_the_fence_is_not_repaired(self):
        result, _ = run(RECORDING['replies']['prose_around_fence'], RECORDING['replies']['prose_around_fence'])
        self.assertEqual(result['error'], 'Het lokale model antwoordde niet in het gevraagde formaat. Probeer het opnieuw.')
        self.assertEqual(result['reason'], 'not_json')
        self.assertEqual(result['assessments'], [])

    def test_extra_duplicate_and_alien_items_are_dropped_per_item(self):
        result, port = run(RECORDING['replies']['extra_items'])
        self.assertNotIn('error', result)
        self.assertEqual([a['criterionId'] for a in result['assessments']], ['c1', 'c2', 'c3'])
        self.assertEqual(by_id(result)['c1']['explanation'], 'Prijs genoemd en toegelicht door de verkoper.')
        self.assertEqual(port.call_count, 1)

    def test_too_much_evidence_is_bounded_not_fatal(self):
        result, _ = run(RECORDING['replies']['too_much_evidence'])
        self.assertNotIn('error', result)
        self.assertLessEqual(len(by_id(result)['c1']['evidence']), 3)
        self.assertEqual(by_id(result)['c1']['status'], 'covered')

    def test_missing_criterion_gets_one_bounded_repeat_round_with_only_that_criterion(self):
        second = json.dumps({'assessments': [{'criterionId': 'c3', 'status': 'unmentioned', 'evidence': [],
                                             'explanation': 'Niet besproken.', 'kind': 'none',
                                             'customerConfirmed': False, 'customerEvidence': []}]})
        result, port = run(RECORDING['replies']['missing_c3'], second)
        self.assertEqual(port.call_count, 2)
        sent = json.loads(port.call_args_list[1].kwargs['messages'][1]['content'])
        self.assertEqual([c['id'] for c in sent['criteria']], ['c3'])
        self.assertEqual(by_id(result)['c3']['explanation'], 'Niet besproken.')
        self.assertEqual(by_id(result)['c1']['status'], 'covered')

    def test_still_missing_after_repeat_is_uncertain_never_invented_and_never_a_third_call(self):
        result, port = run(RECORDING['replies']['missing_c3'])
        self.assertEqual(port.call_count, 2)
        self.assertNotIn('error', result)
        row = by_id(result)['c3']
        self.assertEqual((row['status'], row['evidence'], row['kind']), ('uncertain', [], 'none'))

    def test_forged_quote_drops_that_item_to_uncertain_but_keeps_the_valid_rest(self):
        result, _ = run(RECORDING['replies']['forged_quote'])
        self.assertNotIn('honderd euro', json.dumps(result, ensure_ascii=False))
        rows = by_id(result)
        self.assertEqual(rows['c1']['status'], 'uncertain')
        self.assertEqual(rows['c2']['status'], 'covered')

    def test_legacy_answer_without_new_fields_gets_conservative_defaults(self):
        result, _ = run(RECORDING['replies']['legacy_without_kind'])
        rows = by_id(result)
        self.assertEqual((rows['c1']['kind'], rows['c1']['customerConfirmed'], rows['c1']['customerEvidence']),
                         ('explained', False, []))
        self.assertEqual(rows['c3']['kind'], 'none')

    def test_truncated_and_prose_answers_become_a_content_free_reason(self):
        for name in ('truncated', 'not_json'):
            with self.subTest(name):
                result, port = run(RECORDING['replies'][name], RECORDING['replies'][name])
                self.assertEqual(result['reason'], 'not_json')
                self.assertEqual(result['assessments'], [])
                self.assertEqual(port.call_count, 2)
                self.assertNotIn('Garantie', json.dumps(result))

    def test_second_round_can_rescue_a_first_unparseable_answer(self):
        result, port = run(RECORDING['replies']['truncated'], RECORDING['replies']['fenced'])
        self.assertNotIn('error', result)
        self.assertEqual(by_id(result)['c1']['status'], 'covered')
        self.assertEqual(port.call_count, 2)


class LevelRules(unittest.TestCase):
    def reply(self, **changes):
        base = {'criterionId': 'c1', 'status': 'covered', 'evidence': [{'segmentId': 's1', 'quote': 'tien euro'}],
                'explanation': 'x', 'kind': 'explained', 'customerConfirmed': False, 'customerEvidence': []}
        base.update(changes)
        return json.dumps({'assessments': [base]})

    def one(self, **changes):
        request = dict(RECORDING['request'], criteria=RECORDING['request']['criteria'][:1])
        result, _ = run(self.reply(**changes), request=request)
        return result['assessments'][0]

    def test_customer_only_statement_is_mentioned_never_explained(self):
        row = self.one(status='covered', evidence=[{'segmentId': 's2', 'quote': 'hoe lang duurt de levering'}])
        self.assertNotEqual(row['status'], 'covered')
        self.assertEqual(row['kind'], 'mentioned')

    def test_explained_without_confirmed_seller_mapping_is_downgraded(self):
        request = dict(RECORDING['request'], criteria=RECORDING['request']['criteria'][:1], mappingConfirmed=False)
        result, _ = run(self.reply(), request=request)
        row = result['assessments'][0]
        self.assertEqual(row['status'], 'uncertain')
        self.assertNotEqual(row['kind'], 'explained')

    def test_covered_status_cannot_claim_less_than_explained(self):
        row = self.one(kind='mentioned')
        self.assertEqual(row['status'], 'partial')
        self.assertEqual(row['kind'], 'mentioned')

    def test_customer_confirmation_needs_a_customer_segment_quote(self):
        ok = self.one(customerConfirmed=True, customerEvidence=[{'segmentId': 's4', 'quote': 'dat is akkoord'}])
        self.assertTrue(ok['customerConfirmed'])
        for evidence in ([], [{'segmentId': 's1', 'quote': 'tien euro'}],
                         [{'segmentId': 's4', 'quote': 'niet gezegd'}]):
            with self.subTest(evidence=evidence):
                row = self.one(customerConfirmed=True, customerEvidence=evidence)
                self.assertFalse(row['customerConfirmed'])
                self.assertEqual(row['customerEvidence'], [])

    def test_customer_confirmation_does_not_make_a_point_explained(self):
        row = self.one(status='unmentioned', evidence=[], kind='none', customerConfirmed=True,
                       customerEvidence=[{'segmentId': 's4', 'quote': 'dat is akkoord'}])
        self.assertEqual(row['kind'], 'none')
        self.assertNotEqual(row['status'], 'covered')

    def test_unknown_kind_value_drops_the_item(self):
        row = self.one(kind='begrepen')
        self.assertEqual(row['status'], 'uncertain')

    def test_rejected_or_partly_unusable_citations_are_uncertain_not_unmentioned(self):
        request = dict(RECORDING['request'], criteria=RECORDING['request']['criteria'][:1])
        reply = json.dumps({'assessments': [{
            'criterionId': 'c1', 'status': 'covered',
            'evidence': [{'segmentId': 's1', 'quote': 'tien euro'}, {'segmentId': 's1', 'quote': 'verzonnen citaat'}],
            'explanation': 'Deels bruikbaar bewijs.', 'kind': 'explained', 'customerConfirmed': False, 'customerEvidence': [],
        }]})
        result, _ = run(reply, request=request)
        row = result['assessments'][0]
        self.assertEqual(row['status'], 'uncertain')
        self.assertNotEqual(row['status'], 'unmentioned')


class Reasons(unittest.TestCase):
    def evaluate_with(self, exc):
        from src import veneta_checklist as vc
        port = mock.Mock(side_effect=exc)
        return vc.evaluate(RECORDING['request'], config=config(), model_port=port)

    def test_reasons_from_port_errors_are_content_free(self):
        from src import veneta_checklist as vc
        for error, reason in [(vc.ChecklistError('server_unreachable'), 'server_unreachable'),
                              (vc.ChecklistError('model_missing'), 'model_missing'),
                              (vc.ChecklistError('timeout'), 'timeout'),
                              (RuntimeError('secret prompt text'), 'failed')]:
            with self.subTest(reason=reason):
                result = self.evaluate_with(error)
                self.assertEqual(result['reason'], reason)
                self.assertEqual(result['assessments'], [])
                self.assertNotIn('secret', json.dumps(result))
                self.assertTrue(result['error'])

    def test_provider_that_is_not_local_has_its_own_reason(self):
        from src import veneta_checklist as vc
        cfg = config()
        cfg.get_ai_provider.return_value = 'cloud'
        port = mock.Mock()
        result = vc.evaluate(RECORDING['request'], config=cfg, model_port=port)
        self.assertEqual(result['reason'], 'provider_not_local')
        port.assert_not_called()


def closed_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class ChatStub:
    """Loopback /api/tags + /api/chat with scripted chat content and optional delay."""
    def __init__(self, tags, content='{"assessments": []}', delay=0.0):
        self.tags, self.content, self.delay, self.posts = tags, content, delay, 0

    def __enter__(self):
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self._send(json.dumps(owner.tags).encode())

            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                owner.posts += 1
                time.sleep(owner.delay)
                try:
                    self._send(json.dumps({'message': {'role': 'assistant', 'content': owner.content},
                                           'done': True}).encode())
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


class ServerLifecycle(unittest.TestCase):
    def test_unreachable_server_other_than_the_default_is_reported_and_never_started(self):
        from src import veneta_checklist as vc
        starter = mock.Mock(return_value=True)
        port = vc.OllamaModelPort(f'http://127.0.0.1:{closed_port()}', starter=starter)
        result = vc.evaluate(RECORDING['request'], config=config(), model_port=port)
        self.assertEqual(result['reason'], 'server_unreachable')
        starter.assert_not_called()

    def test_default_endpoint_with_dead_server_is_started_once_then_verified(self):
        from src import veneta_checklist as vc
        with ChatStub(local_tags(), RECORDING['replies']['fenced']) as stub:
            calls = []
            port = vc.OllamaModelPort(f'http://127.0.0.1:{closed_port()}')
            port._startable = True  # stands in for the default 127.0.0.1:11434 endpoint

            def start_and_move():
                calls.append(1)
                port.endpoint = stub.endpoint
                return True

            port._starter = start_and_move
            result = vc.evaluate(RECORDING['request'], config=config(), model_port=port)
        self.assertNotIn('error', result, result)
        self.assertEqual(len(calls), 1)
        self.assertEqual(by_id(result)['c1']['status'], 'covered')

    def test_start_helper_failure_is_server_start_failed(self):
        from src import veneta_checklist as vc
        port = vc.OllamaModelPort(f'http://127.0.0.1:{closed_port()}', starter=lambda: False)
        port._startable = True
        result = vc.evaluate(RECORDING['request'], config=config(), model_port=port)
        self.assertEqual(result['reason'], 'server_start_failed')

    def test_only_the_default_endpoint_is_startable(self):
        from src import veneta_checklist as vc
        self.assertTrue(vc.OllamaModelPort('http://127.0.0.1:11434')._startable)
        self.assertTrue(vc.OllamaModelPort('http://localhost:11434')._startable)
        self.assertFalse(vc.OllamaModelPort('http://127.0.0.1:11435')._startable)

    def test_missing_model_never_pulls_and_never_sends_the_transcript(self):
        from src import veneta_checklist as vc
        with ChatStub(local_tags('another-model')) as stub, mock.patch('ollama.Client.pull') as pull:
            result = vc.evaluate(RECORDING['request'], config=config(), model_port=vc.OllamaModelPort(stub.endpoint))
        self.assertEqual(result['reason'], 'model_missing')
        self.assertEqual(stub.posts, 0)
        pull.assert_not_called()

    def test_slow_model_is_a_timeout_reason(self):
        from src import veneta_checklist as vc
        with ChatStub(local_tags(), delay=1.5) as stub, mock.patch.object(vc, 'CHAT_TIMEOUT_SECONDS', 0.3):
            result = vc.evaluate(RECORDING['request'], config=config(), model_port=vc.OllamaModelPort(stub.endpoint))
        self.assertEqual(result['reason'], 'timeout')

    def test_real_wire_fenced_answer_end_to_end(self):
        from src import veneta_checklist as vc
        with ChatStub(local_tags(), RECORDING['replies']['think_then_fenced']) as stub:
            result = vc.evaluate(RECORDING['request'], config=config(), model_port=vc.OllamaModelPort(stub.endpoint))
        self.assertNotIn('error', result, result)
        self.assertEqual(by_id(result)['c2']['customerConfirmed'], True)
        self.assertEqual(stub.posts, 1)

    def test_default_start_helper_launches_only_the_installed_binary_with_serve(self):
        """Start helper contract with a fake binary: serve only, no pull, no other arguments."""
        from src import ollama_manager, veneta_checklist as vc
        with tempfile.TemporaryDirectory(dir=SCRATCH, prefix='checklist-start-') as tmp:
            fake = Path(tmp) / 'ollama'
            log = Path(tmp) / 'args.log'
            fake.write_text(f'#!/bin/sh\necho "$@" >> "{log}"\n')
            fake.chmod(fake.stat().st_mode | stat.S_IXUSR)
            states = iter([False, False, True, True, True])
            with mock.patch.dict(os.environ, {'STENOAI_USER_DATA_DIR': tmp}), \
                    mock.patch.object(ollama_manager, 'get_ollama_binary', return_value=fake), \
                    mock.patch.object(ollama_manager, 'is_ollama_running', side_effect=lambda: next(states)), \
                    mock.patch.object(ollama_manager.time, 'sleep'):
                self.assertTrue(vc.start_local_server())
            deadline = time.time() + 5
            while not log.exists() and time.time() < deadline:
                time.sleep(0.05)
            self.assertEqual(log.read_text().split(), ['serve'])


if __name__ == '__main__':
    unittest.main()


class WholeWordQuotes(unittest.TestCase):
    """Review 0.9.2 (f): a citation is at least one whole word and at least three characters."""

    def request(self):
        return {'sessionId': 's', 'revision': 'r', 'mappingConfirmed': True,
                'criteria': [{'id': 'c1', 'label': 'Prijs', 'required': True}],
                'segments': [{'id': 's1', 'text': 'De prijs is tien euro per maand.', 'speaker': 'seller', 'start': 0, 'end': 2}]}

    def row(self, quote):
        return {'assessments': [{'criterionId': 'c1', 'status': 'covered', 'explanation': 'x',
                                 'evidence': [{'segmentId': 's1', 'quote': quote}]}]}

    def test_strict_validation_rejects_fragments(self):
        from src import veneta_checklist as vc
        for quote in ('ri', 'pri', 'rijs is', 'tie', 'euro per maan', 'is', ' a '):
            with self.subTest(quote=quote), self.assertRaises(ValueError):
                vc.validate_response(self.row(quote), self.request())

    def test_strict_validation_accepts_whole_words(self):
        from src import veneta_checklist as vc
        for quote in ('prijs', 'tien euro', 'De prijs is tien euro per maand.', 'euro per maand.'):
            with self.subTest(quote=quote):
                out = vc.validate_response(self.row(quote), self.request())
                self.assertEqual(out['assessments'][0]['status'], 'covered')

    def test_salvage_drops_fragment_quotes_per_item(self):
        from src import veneta_checklist as vc
        out = vc.salvage_response(self.row('rijs is'), self.request())
        row = out['c1']
        self.assertEqual(row['evidence'], [])
        self.assertNotEqual(row['status'], 'covered')
