"""Synthetic, provider-free tests for the read-only folding protocol."""
import copy
import json
import os
import tempfile
import unittest
from unittest import mock

from src.textfold_tokens import plain


def unit0(doc, n=0):
    return doc['sections'][n]['units'][0]


def ev_text(unit):
    return [plain(unit['toks'][a:b], {}) for a, b in [unit['sents'][i] for i in unit['lad']['ev']]]


class FoldingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.env = mock.patch.dict(os.environ, {'STENOAI_USER_DATA_DIR': self.temp.name})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.request = {'schemaVersion': 2, 'sourceHash': 'a' * 64, 'sections': [
            {'id': 'budget', 'title': 'Budget', 'full': '  Kosten stijgen. Besluit: eerst testen. Risico blijft onzeker.\n'}]}
        self.answer = {'sections': [{'id': 'budget', 'evidence': [1, 2],
                                    'key': 'Eerst testen vanwege onzekerheid.',
                                    'takeaway': 'Eerst testen.', 'topic': 'Budgetrisico'}]}

    def test_ai_prepares_every_layer_with_exact_evidence_and_untouched_source(self):
        from src.summary_folding import prepare_folding
        original = copy.deepcopy(self.request)
        provider = mock.Mock()
        provider.ai_provider = 'cloud'
        provider._stream_completion.return_value = iter([json.dumps(self.answer)])
        result = None
        try:
            result = prepare_folding(self.request, provider)
        except ValueError:
            pass
        self.assertIsInstance(result, dict, 'AI folding should return the versioned document')
        self.assertEqual(result['sourceHash'], self.request['sourceHash'])
        self.assertEqual(result['schemaVersion'], 2)
        section = result['sections'][0]
        self.assertEqual(section['full'], original['sections'][0]['full'])
        unit = section['units'][0]
        self.assertEqual(result['provenance'], 'ai')
        self.assertEqual([plain(unit['toks'][x:y], {}) for x, y in unit['sents']],
                         ['Kosten stijgen.', 'Besluit: eerst testen.', 'Risico blijft onzeker.'])
        self.assertEqual(unit['lad']['ev'], [1, 2])
        self.assertEqual(ev_text(unit), ['Besluit: eerst testen.', 'Risico blijft onzeker.'])
        written = plain(unit['lad']['brief'], {})
        self.assertTrue(written.startswith('Eerst testen.'), written)
        self.assertIn('vanwege onzekerheid', written)
        self.assertEqual(plain(unit['lad']['brief'][:unit['lad']['tn']], {}), 'Eerst testen')
        self.assertEqual(plain(unit['lad']['topic'], {}), 'Budgetrisico')
        self.assertTrue(all(0 <= t['m'] < len(unit['toks']) for t in unit['lad']['brief'] if 'm' in t))
        self.assertEqual(self.request, original)
        provider._stream_completion.assert_called_once()
        prompt = provider._stream_completion.call_args.args[0]
        self.assertIn('untrusted', prompt)
        self.assertIn('instructions', prompt)
        self.assertIn('Risico blijft onzeker.', prompt)


    def test_invalid_requests_are_rejected_before_any_model_call(self):
        from src.summary_folding import prepare_folding
        invalid = [None, [], {}, dict(self.request, schemaVersion=True),
                   dict(self.request, schemaVersion=1), dict(self.request, sourceHash='a' * 63),
                   dict(self.request, sourceHash='a' * 64 + '\n'),
                   dict(self.request, sections=[]), dict(self.request, extra=True),
                   dict(self.request, sections=self.request['sections'] * 2),
                   dict(self.request, sections=[{'id': '', 'title': 't', 'full': 'f'}]),
                   dict(self.request, sections=[{'id': 'a', 'title': 1, 'full': 'f'}]),
                   dict(self.request, sections=[{'id': 'a', 'title': 't', 'full': 'f', 'extra': 1}]),
                   dict(self.request, sections=[{'id': str(i), 'title': '', 'full': 'f'} for i in range(65)]),
                   dict(self.request, sections=[{'id': 'a', 'title': '', 'full': 'x' * 96001}]),
                   dict(self.request, sections=[{'id': 'a', 'title': 'x' * (256 * 1024), 'full': 'f'}])]
        provider = mock.Mock()
        for request in invalid:
            with self.subTest(request_type=type(request).__name__):
                try:
                    prepare_folding(request, provider)
                except ValueError as exc:
                    self.assertNotIn('Kosten', str(exc))
                except Exception as exc:
                    self.fail('Input boundary must reject with sanitized ValueError, not ' + type(exc).__name__)
                else:
                    self.fail('Invalid request was accepted')
        provider._stream_completion.assert_not_called()

    def test_invalid_ai_responses_fail_closed_without_fabricated_fallback(self):
        from src.summary_folding import prepare_folding
        item = self.answer['sections'][0]
        # 0.9.1: an answer whose every item is out of contract still fails closed
        # (after bounded retries). Tolerated envelopes are covered below and in
        # test_summary_folding_local_model.py.
        variants = [dict(item, id='invented'),
                    dict(item, evidence=[]), dict(item, evidence=[True]),
                    dict(item, evidence=[-1]), dict(item, evidence=[3]),
                    dict(item, evidence=['1']),
                    dict(item, evidence=None), dict(item, key='  '),
                    dict(item, topic=None), dict(item, takeaway=123),
                    dict(item, key='SECRET ' * 200),
                    {k: v for k, v in item.items() if k != 'evidence'}]
        responses = [json.dumps({'sections': [value]}) for value in variants]
        responses += ['not JSON SECRET', 'Hier: ```json\n' + json.dumps(self.answer) + '\n```',
                      json.dumps({'sections': []}), '[]', json.dumps({'sections': {'SECRET': 1}}),
                      '{"sections": [], "sections": ' + json.dumps([item]) + '}']
        for response in responses:
            with self.subTest(response=response[:80]):
                provider = mock.Mock(ai_provider='cloud')
                provider._stream_completion.return_value = iter([response])
                try:
                    prepare_folding(self.request, provider)
                except ValueError as exc:
                    self.assertNotIn('SECRET', str(exc))
                except Exception as exc:
                    self.fail('Model boundary must raise sanitized ValueError, not ' + type(exc).__name__)
                else:
                    self.fail('Invalid AI output was accepted')

    def test_tolerated_answer_envelopes_never_carry_extra_content_into_the_result(self):
        from src.summary_folding import prepare_folding
        item = self.answer['sections'][0]
        tolerated = [json.dumps({'sections': [dict(item, extra='SECRET')]}),
                     json.dumps({'sections': [dict(item, evidence=[1, 1, 2])]}),
                     '```json\n' + json.dumps(self.answer) + '\n```',
                     json.dumps(dict(self.answer, extra='SECRET')),
                     json.dumps({'sections': [item, dict(item, id='SECRET-invented')]})]
        for response in tolerated:
            with self.subTest(response=response[:60]):
                provider = mock.Mock(ai_provider='cloud')
                provider._stream_completion.return_value = iter([response])
                result = prepare_folding(self.request, provider)
                self.assertNotIn('SECRET', json.dumps(result))
                self.assertEqual(unit0(result)['lad']['ev'], [1, 2])
                self.assertEqual(ev_text(unit0(result)), ['Besluit: eerst testen.', 'Risico blijft onzeker.'])


    def test_cli_reads_only_stdin_outputs_only_json_and_preserves_old_note(self):
        from click.testing import CliRunner
        from pathlib import Path
        import simple_recorder
        note = Path(self.temp.name) / 'canonical-summary.json'
        note.write_bytes(b'{"synthetic":"old summary"}')
        provider = mock.Mock(ai_provider='cloud')
        provider._stream_completion.return_value = iter([json.dumps(self.answer)])
        with mock.patch.object(simple_recorder, 'OllamaSummarizer', return_value=provider) as factory:
            result = CliRunner().invoke(simple_recorder.cli, ['summary-fold'], input=json.dumps(self.request))
        self.assertEqual(result.exit_code, 0, result.output)
        try:
            parsed = json.loads(result.output)
        except ValueError:
            self.fail(repr(result.output))
        self.assertEqual(ev_text(unit0(parsed)), ['Besluit: eerst testen.', 'Risico blijft onzeker.'])
        factory.assert_called_once_with()
        self.assertEqual(note.read_bytes(), b'{"synthetic":"old summary"}')

    def test_cli_rejects_bounded_invalid_input_before_constructing_provider(self):
        from click.testing import CliRunner
        import simple_recorder
        cases = ['SECRET-invalid', json.dumps(dict(self.request, sourceHash='SECRET')),
                 ' ' * (256 * 1024 + 1),
                 '{"schemaVersion":1,"schemaVersion":1,"sourceHash":"' + 'a' * 64 + '","sections":[]}']
        for text in cases:
            with mock.patch.object(simple_recorder, 'OllamaSummarizer') as factory:
                result = CliRunner().invoke(simple_recorder.cli, ['summary-fold'], input=text)
            self.assertEqual(result.exit_code, 1, result.output)
            self.assertEqual(set(json.loads(result.output)), {'error', 'reason'})
            self.assertIn(json.loads(result.output)['reason'], ('invalid_request', 'too_long'))
            self.assertNotIn('SECRET', result.output)
            factory.assert_not_called()


    def test_long_summary_is_chunked_without_dropping_source_and_merged_by_ai(self):
        from src.summary_folding import prepare_folding
        request = copy.deepcopy(self.request)
        request['sections'][0]['full'] = ' '.join('Punt %s: %s.' % (i, ('bewijs ' * 35).strip()) for i in range(100))
        provider = mock.Mock(ai_provider='remote', model_name='llama3.2:3b')
        provider._ollama_options.return_value = {'num_ctx': 8192}
        seen = []
        prompts = []
        def chat(client, **kwargs):
            prompt = kwargs['messages'][0]['content']
            prompts.append(prompt)
            for text in respond(prompt):
                yield {'message': {'content': text}}
        def respond(prompt):
            payload = json.loads(prompt.split('SOURCE DATA:\n', 1)[1])
            seen.append(payload)
            results = []
            for section in payload:
                if 'sentences' in section:
                    evidence = [section['sentences'][-1]['index']]
                else:
                    evidence = [section['candidates'][-1]['evidence'][-1]]
                results.append({'id': section['id'], 'evidence': evidence,
                                'key': 'Onderbouwde punten.', 'takeaway': 'Bewijs.', 'topic': 'Punten'})
            return iter([json.dumps({'sections': results})])
        provider._chat_stream_no_think.side_effect = chat
        result = prepare_folding(request, provider)
        self.assertGreater(len(prompts), 1)
        originals = [sentence['text'] for batch in seen for section in batch
                     for sentence in section.get('sentences', [])]
        from src.textfold_tokens import split_sentences, tokenize_text
        toks = tokenize_text(request['sections'][0]['full'])
        self.assertEqual(originals, [plain(toks[a:b], {}) for a, b in split_sentences(toks)])
        self.assertEqual(len(originals), 100)
        self.assertTrue(any('candidates' in section for batch in seen for section in batch))
        for prompt in prompts:
            self.assertLessEqual(len(prompt), 6500)
        self.assertEqual(result['sections'][0]['full'], request['sections'][0]['full'])
        self.assertEqual(unit0(result)['lad']['ev'], [99])
        self.assertEqual(ev_text(unit0(result)), [originals[-1]])


    def test_evidence_is_a_brief_selection_and_oversized_spans_fail_without_truncation(self):
        from src.summary_folding import prepare_folding
        request = copy.deepcopy(self.request)
        request['sections'][0]['full'] = 'Een. Twee. Drie. Vier.'
        answer = copy.deepcopy(self.answer)
        answer['sections'][0]['evidence'] = [0, 1, 2, 3]
        provider = mock.Mock(ai_provider='cloud')
        provider._stream_completion.return_value = iter([json.dumps(answer)])
        # 0.9.1: a fourth pick is dropped deterministically instead of failing the fold.
        self.assertEqual(ev_text(unit0(prepare_folding(request, provider))), ['Een.', 'Twee.', 'Drie.'])
        request['sections'][0]['full'] = 'x' * 16000
        provider.reset_mock()
        with self.assertRaises(ValueError):
            prepare_folding(request, provider)
        provider._stream_completion.assert_not_called()
        request['sections'][0]['full'] = 'Zin. ' * 8193
        with self.assertRaises(ValueError):
            prepare_folding(request, provider)
        provider._stream_completion.assert_not_called()


    def test_real_cli_subprocess_uses_configured_remote_provider_offline(self):
        """Transport smoke, not a claim about real model quality."""
        import subprocess
        import sys
        import threading
        from pathlib import Path
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        from src.config import Config
        received = []
        answer = json.dumps(self.answer)
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format, *args):
                pass
            def do_POST(self):
                received.append((self.path, json.loads(self.rfile.read(int(self.headers['Content-Length'])))))
                self.send_response(200)
                self.send_header('Content-Type', 'application/x-ndjson')
                self.end_headers()
                for part in (answer[:30], answer[30:]):
                    self.wfile.write((json.dumps({'message': {'role': 'assistant', 'content': part}, 'done': False}) + '\n').encode())
                self.wfile.write(b'{"message":{"role":"assistant","content":""},"done":true}\n')
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        config = Config()
        self.assertTrue(config.set_ai_provider('remote'))
        self.assertTrue(config.set_remote_ollama_url('http://127.0.0.1:' + str(server.server_port)))
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', NO_PROXY='127.0.0.1,localhost', no_proxy='127.0.0.1,localhost')
        result = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / 'simple_recorder.py'), 'summary-fold'],
                                input=json.dumps(self.request), capture_output=True, text=True, env=env, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stderr, '')
        document = json.loads(result.stdout)
        self.assertEqual(document['sections'][0]['full'], self.request['sections'][0]['full'])
        self.assertEqual(ev_text(unit0(document)), ['Besluit: eerst testen.', 'Risico blijft onzeker.'])
        self.assertEqual(len(received), 1)
        path, call = received[0]
        self.assertEqual(path, '/api/chat')
        self.assertEqual(call['model'], config.get_model())
        self.assertIs(call['stream'], True)
        self.assertIn('FULL DETAILED SUMMARY', call['messages'][0]['content'])
        from src.summary_folding import RESPONSE_SCHEMA
        self.assertEqual(call['format'], RESPONSE_SCHEMA)


    def test_many_sections_bound_output_budget_and_keep_original_order(self):
        from src.summary_folding import prepare_folding
        request = dict(self.request, sections=[{'id': str(i), 'title': '', 'full': 'Bron %s.' % i} for i in range(64)])
        provider = mock.Mock(ai_provider='cloud')
        batch_sizes = []
        def respond(prompt):
            payload = json.loads(prompt.split('SOURCE DATA:\n', 1)[1])
            batch_sizes.append(len(payload))
            return iter([json.dumps({'sections': [{'id': s['id'], 'evidence': [0], 'key': 'Bron.',
                                                  'takeaway': 'Bron', 'topic': 'Bron'} for s in reversed(payload)]})])
        provider._stream_completion.side_effect = respond
        result = prepare_folding(request, provider)
        self.assertEqual([s['id'] for s in result['sections']], [str(i) for i in range(64)])
        self.assertLessEqual(max(batch_sizes), 4, 'Reserve output space as well as input context')
        self.assertEqual(sum(batch_sizes), 64)


    def test_cli_provider_errors_do_not_leak_raw_output_to_either_stream(self):
        from click.testing import CliRunner
        import simple_recorder
        import sys
        def fail():
            print('SECRET provider stdout')
            print('SECRET provider stderr', file=sys.stderr)
            raise RuntimeError('SECRET raw provider body')
        with mock.patch.object(simple_recorder, 'OllamaSummarizer', side_effect=fail):
            result = CliRunner().invoke(simple_recorder.cli, ['summary-fold'], input=json.dumps(self.request))
        self.assertEqual(result.exit_code, 1)
        self.assertNotIn('SECRET', result.output)
        self.assertEqual(json.loads(result.stdout), {'error': json.loads(result.stdout)['error'],
                                                     'reason': 'provider_unavailable'})
        self.assertEqual(result.stderr, '')


class PromptContractTests(unittest.TestCase):
    def test_topic_is_a_bare_noun_phrase_without_article(self):
        """Review 0.9.2 (g): the topic label is a bare noun phrase, never led by an article."""
        from src.summary_folding import _PROMPT
        self.assertIn('bare noun phrase without an article', _PROMPT)
        self.assertIn('copied from inside the takeaway', _PROMPT)


if __name__ == '__main__':
    unittest.main()
