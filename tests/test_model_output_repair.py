"""Small local models (gemma4 on Ollama's MLX runner) do not obey the format schema.

Measured by the parent on a synthetic conversation against gemma4:e2b-nvfp4: without an
example the model invents its own shape, without think=False thousands of characters go to
``message.thinking``, and even with an example the JSON ends one closing brace short and uses
a status outside the enum. These tests pin the synthetic versions of exactly those shapes.
No real model runs; servers are owned loopback stubs.
"""
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

from src import veneta_checklist as vc
from src.summary_folding import FoldError, parse_model_json, prepare_folding

REQUEST = {
    'sessionId': 'synthetisch', 'revision': 'r1', 'mappingConfirmed': True,
    'criteria': [{'id': 'c1', 'label': 'De looptijd is toegelicht', 'required': True},
                 {'id': 'c2', 'label': 'Het bruto jaarinkomen is gevraagd', 'required': True},
                 {'id': 'c3', 'label': 'De rentevaste periode is uitgelegd', 'required': True}],
    'segments': [
        {'id': 's1', 'text': 'Goedemiddag, fijn dat u er bent.', 'speaker': 'seller', 'start': 0, 'end': 2},
        {'id': 's2', 'text': 'De looptijd van de hypotheek is dertig jaar, dat leg ik zo uit.',
         'speaker': 'seller', 'start': 2, 'end': 6},
        {'id': 's3', 'text': 'Een rentevaste periode betekent dat de rente tien jaar gelijk blijft.',
         'speaker': 'seller', 'start': 6, 'end': 10}]}


def item(cid, status, segment, explanation='Uitgelegd.'):
    covered = status == 'covered'
    return {'criterionId': cid, 'status': status, 'kind': 'explained' if covered else 'none',
            'evidence': ([{'segmentId': segment['id'], 'quote': segment['text'].rstrip('.')}] if covered else []),
            'customerConfirmed': False, 'customerEvidence': [], 'explanation': explanation}


S2, S3 = REQUEST['segments'][1], REQUEST['segments'][2]
# The exact broken ending measured on the real model: the last object loses its closing brace,
# so the text ends on '..."]}' instead of '..."}]}'.
MISSING_BRACE = json.dumps({'assessments': [item('c1', 'covered', S2), item('c3', 'covered', S3)]})[:-3] + ']}'
NOT_COVERED = (json.dumps({'assessments': [item('c1', 'covered', S2), item('c2', 'not covered', S2),
                                            item('c3', 'covered', S3)]})[:-3] + ']}')


class JsonRepair(unittest.TestCase):
    def test_the_measured_ending_with_a_missing_object_brace_is_repaired(self):
        self.assertTrue(MISSING_BRACE.endswith('."]}'), MISSING_BRACE[-30:])
        with self.assertRaises(ValueError):
            json.loads(MISSING_BRACE)
        parsed = parse_model_json(MISSING_BRACE)
        self.assertEqual([a['criterionId'] for a in parsed['assessments']], ['c1', 'c3'])
        self.assertEqual(parsed['assessments'][1]['explanation'], 'Uitgelegd.')

    def test_missing_closers_at_the_end_are_appended_in_the_right_order(self):
        for broken, expected in [
                ('{"a": [{"b": 1}', {'a': [{'b': 1}]}),
                ('{"a": [{"b": [1, 2]', {'a': [{'b': [1, 2]}]}),
                ('{"sections": [{"id": "x", "evidence": [0]', {'sections': [{'id': 'x', 'evidence': [0]}]}),
                ('```json\n{"a": [1]\n```', {'a': [1]})]:
            with self.subTest(broken=broken):
                self.assertEqual(parse_model_json(broken), expected)

    def test_brackets_inside_strings_are_not_counted_and_escapes_are_respected(self):
        self.assertEqual(parse_model_json('{"a": "x}]"'), {'a': 'x}]'})
        self.assertEqual(parse_model_json('{"a": "say \\"hi\\" }"'), {'a': 'say "hi" }'})

    def test_nothing_is_invented_and_ambiguous_damage_stays_rejected(self):
        for bad in ['{"a": "unterminated', '{"a": ', '{"a": 1,', '{"a": [1}, "b": 2}', '{"a": 1}}',
                    '[[[[[[[[[[[[[[[[[[[[[[1', 'Hier is het: {"a": 1', '{"a": 1} {"b": 2}', '',
                    '{"a": 1, "a": 2', '{"a": NaN']:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                parse_model_json(bad)

    def test_valid_json_is_untouched(self):
        self.assertEqual(parse_model_json('{"a": [1, {"b": 2}]}'), {'a': [1, {'b': 2}]})

    def test_the_repair_only_completes_the_text_it_was_given(self):
        parsed = parse_model_json(MISSING_BRACE)
        original = json.loads(json.dumps({'assessments': [item('c1', 'covered', S2), item('c3', 'covered', S3)]}))
        self.assertEqual(parsed, original)


class ChecklistGetsTheRepairedAnswer(unittest.TestCase):
    def run_checklist(self, *replies):
        port = mock.Mock(side_effect=list(replies) if len(replies) > 1 else None,
                         return_value=replies[0] if len(replies) == 1 else None)
        config = mock.Mock()
        config.get_ai_provider.return_value = 'local'
        config.get_model.return_value = 'fixture-model'
        return vc.evaluate(REQUEST, config=config, model_port=port), port

    def test_a_reply_missing_its_last_brace_still_yields_checked_items(self):
        result, _ = self.run_checklist(MISSING_BRACE, '{"assessments": []}')
        self.assertNotIn('error', result, result)
        status = {a['criterionId']: a['status'] for a in result['assessments']}
        self.assertEqual((status['c1'], status['c3']), ('covered', 'covered'))
        self.assertEqual(status['c2'], 'uncertain')

    def test_an_unknown_status_is_refused_per_item_never_guessed_to_a_synonym(self):
        result, port = self.run_checklist(NOT_COVERED, NOT_COVERED)
        status = {a['criterionId']: a['status'] for a in result['assessments']}
        self.assertEqual(status, {'c1': 'covered', 'c2': 'uncertain', 'c3': 'covered'})
        self.assertNotIn('unmentioned', status.values())
        asked_again = json.loads(port.call_args_list[1].kwargs['messages'][1]['content'])
        self.assertEqual([c['id'] for c in asked_again['criteria']], ['c2'])


class PromptAndThinking(unittest.TestCase):
    def test_the_system_prompt_carries_a_compact_example_of_the_exact_shape(self):
        self.assertIn('ids are examples', vc._SYSTEM_PROMPT)
        self.assertIn(json.dumps(vc.EXAMPLE, ensure_ascii=False), vc._SYSTEM_PROMPT)
        row = vc.EXAMPLE['assessments'][0]
        self.assertEqual(set(row), {'criterionId', 'status', 'kind', 'evidence', 'explanation',
                                    'customerConfirmed', 'customerEvidence'})
        self.assertIn(row['status'], vc.STATUSES)
        self.assertLess(len(json.dumps(vc.EXAMPLE)), 900)

    def test_example_also_shows_an_unmentioned_point_without_evidence(self):
        # Measured on gemma4:e2b-nvfp4: a single 'covered' example made the model tick a point
        # nobody mentioned, every run. The example must show both outcomes.
        rows = vc.EXAMPLE['assessments']
        self.assertIn('covered', [r['status'] for r in rows])
        unmentioned = [r for r in rows if r['status'] == 'unmentioned']
        self.assertEqual(len(unmentioned), 1)
        self.assertEqual(unmentioned[0]['kind'], 'none')
        self.assertEqual(unmentioned[0]['evidence'], [])
        for row in rows:
            self.assertEqual(set(row), {'criterionId', 'status', 'kind', 'evidence', 'explanation',
                                        'customerConfirmed', 'customerEvidence'})
        self.assertIn('if no segment does, use unmentioned with empty evidence', vc._SYSTEM_PROMPT)

    def test_every_round_asks_the_model_not_to_think(self):
        port = mock.Mock(return_value=MISSING_BRACE)
        config = mock.Mock()
        config.get_ai_provider.return_value = 'local'
        config.get_model.return_value = 'fixture-model'
        vc.evaluate(REQUEST, config=config, model_port=port)
        self.assertIs(port.call_args_list[0].kwargs['think'], False)
        self.assertIn('"criterionId"', port.call_args_list[0].kwargs['messages'][0]['content'])


class ThinkStub:
    """/api/tags + /api/chat. ``reject_think`` answers 400 to any request that carries ``think``."""

    def __init__(self, content, reject_think=False, delay=0.0, done_reason='stop', thinking=''):
        self.content, self.reject_think, self.delay = content, reject_think, delay
        self.done_reason, self.thinking, self.bodies = done_reason, thinking, []

    def __enter__(self):
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self._send(200, {'models': [{'name': 'm:1', 'model': 'm:1', 'size': 1, 'digest': 'd' * 64,
                                             'details': {'format': 'safetensors'}}]})

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                owner.bodies.append(body)
                import time
                time.sleep(owner.delay)
                if owner.reject_think and 'think' in body:
                    return self._send(400, {'error': '"m:1" does not support thinking'})
                message = {'role': 'assistant', 'content': owner.content}
                if owner.thinking:
                    message['thinking'] = owner.thinking
                self._send(200, {'message': message, 'done': True, 'done_reason': owner.done_reason})

            def _send(self, status, payload):
                data = json.dumps(payload).encode()
                try:
                    self.send_response(status)
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                except OSError:
                    pass

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.endpoint = f'http://127.0.0.1:{self.server.server_port}'
        return self

    def __exit__(self, *args):
        self.server.shutdown()
        self.server.server_close()


class PortThinking(unittest.TestCase):
    def call(self, stub):
        port = vc.OllamaModelPort(stub.endpoint)
        text = port(model='m:1', messages=[{'role': 'user', 'content': 'x'}], think=False, stream=False)
        return port, text

    def test_think_false_is_sent_and_the_content_returned(self):
        with ThinkStub('{"assessments": []}') as stub:
            _, text = self.call(stub)
        self.assertEqual(text, '{"assessments": []}')
        self.assertIs(stub.bodies[0]['think'], False)
        self.assertEqual(len(stub.bodies), 1)

    def test_a_server_that_rejects_think_gets_one_retry_without_it(self):
        with ThinkStub('{"assessments": []}', reject_think=True) as stub:
            _, text = self.call(stub)
        self.assertEqual(text, '{"assessments": []}')
        self.assertEqual(['think' in b for b in stub.bodies], [True, False])

    def test_a_slow_model_is_not_asked_twice(self):
        with ThinkStub('x', delay=1.0) as stub, mock.patch.object(vc, 'CHAT_TIMEOUT_SECONDS', 0.3):
            with self.assertRaises(Exception):
                self.call(stub)
        self.assertEqual(len(stub.bodies), 1)

    def test_the_port_reports_the_done_reason_without_exposing_content(self):
        with ThinkStub('{"assessments": [', done_reason='length') as stub:
            port, _ = self.call(stub)
        self.assertEqual(port.last_done_reason, 'length')


class FinerReasons(unittest.TestCase):
    def reason_for(self, reply, done_reason=None):
        port = mock.Mock(return_value=reply)
        port.last_done_reason = done_reason
        config = mock.Mock()
        config.get_ai_provider.return_value = 'local'
        config.get_model.return_value = 'fixture-model'
        result = vc.evaluate(REQUEST, config=config, model_port=port)
        return result

    def test_each_failure_shape_has_its_own_content_free_reason(self):
        cases = [('', 'empty_answer', None), ('   \n', 'empty_answer', None),
                 ('Ik kan dit niet beoordelen.', 'not_json', None),
                 ('{"c1": "explained", "c2": "unmentioned"}', 'wrong_shape', None),
                 ('{"assessments": "x"}', 'wrong_shape', None),
                 ('[1, 2]', 'wrong_shape', None),
                 ('{"assessments": [{"criterionId": "c1", "explanation": "Te kort afgekapt voor de', 'truncated', 'length'),
                 ('Ik kan dit niet beoordelen.', 'truncated', 'length')]
        for reply, reason, done in cases:
            with self.subTest(reply=reply[:30], done=done):
                result = self.reason_for(reply, done)
                self.assertEqual(result['reason'], reason)
                self.assertTrue(result['error'])
                self.assertNotIn('Ik kan', json.dumps(result))

    def test_a_repairable_reply_that_hit_the_length_limit_is_still_used(self):
        result = self.reason_for(MISSING_BRACE, 'length')
        self.assertNotIn('error', result, result)

    def test_all_new_reasons_have_a_message_and_are_known_to_the_probe(self):
        from src.model_probe import ALLOWED_REASONS
        for reason in ('empty_answer', 'not_json', 'wrong_shape', 'truncated'):
            self.assertIn(reason, vc.MESSAGES)
            self.assertIn(reason, ALLOWED_REASONS)


class FoldGetsTheRepairedAnswer(unittest.TestCase):
    REQ = {'schemaVersion': 2, 'sourceHash': 'a' * 64,
           'sections': [{'id': 'budget', 'title': 'Budget', 'full': 'Kosten stijgen. Besluit: eerst testen.'}]}

    def provider(self, text):
        provider = mock.Mock(ai_provider='cloud')
        provider._stream_completion.side_effect = lambda prompt: iter([text])
        return provider

    def test_a_fold_answer_missing_its_closing_braces_is_repaired(self):
        broken = ('{"sections": [{"id": "budget", "evidence": [1], "key": "Eerst testen.", '
                  '"takeaway": "Testen.", "topic": "Budget"')
        result = prepare_folding(self.REQ, self.provider(broken))
        self.assertEqual(result['sections'][0]['units'][0]['lad']['ev'], [1])

    def test_unrepairable_fold_answers_still_fail_with_the_same_reason(self):
        with self.assertRaises(FoldError) as caught:
            prepare_folding(self.REQ, self.provider('{"sections": [{"id": "budget", "key": "afgekapt'))
        self.assertEqual(caught.exception.reason, 'invalid_structure')

    def test_the_fold_prompt_already_shows_the_exact_shape(self):
        from src.summary_folding import _PROMPT
        self.assertIn('{"sections":[{"id":"supplied id","evidence":[0],"key":"...","takeaway":"...","topic":"..."}]}', _PROMPT)


if __name__ == '__main__':
    unittest.main()
