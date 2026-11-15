"""Regression tests for summary folding against recorded local-model output.

The fixture holds a fully synthetic, fictitious Dutch summary and the literal
first answers of the default local model (gemma4:e2b, Ollama, think=False) to
the 0.9.0 folding prompt. Those answers made every real preparation fail: the
model wraps JSON in a Markdown code block (Ollama's ``format`` is ignored by
this runtime), picks more than three evidence indices, drops a requested
section, or splits one section into several items with the same id.
No user data and no model are used here.
"""
import copy
import json
import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.textfold_tokens import plain


def unit0(doc, n=0):
    return doc['sections'][n]['units'][0]


def ev_text(unit):
    return [plain(unit['toks'][a:b], {}) for a, b in [unit['sents'][i] for i in unit['lad']['ev']]]

FIXTURE = Path(__file__).parent / 'fixtures' / 'summary-folding-local-model-recording.json'


def _unfenced(raw):
    return json.loads(re.sub(r'^```(?:json)?\s*|\s*```$', '', raw.strip()))


class RecordedModel:
    """Replays the recorded answers; follow-up calls reuse recorded items only."""

    def __init__(self, fixture):
        self.recordings = list(fixture['responses'])
        self.items = {}
        for recording in self.recordings:
            for item in _unfenced(recording['raw'])['sections']:
                self.items.setdefault(item['id'], item)
        self.payloads = []

    def __call__(self, prompt):
        payload = json.loads(prompt.split('SOURCE DATA:\n', 1)[1])
        self.payloads.append(payload)
        ids = [section['id'] for section in payload]
        for recording in self.recordings:
            if recording['ids'] == ids:
                self.recordings.remove(recording)
                return iter([recording['raw']])
        if 'candidates' in payload[0]:
            first = payload[0]['candidates'][0]
            answer = {'sections': [{'id': ids[0], 'evidence': first['evidence'], 'key': first['key'],
                                    'takeaway': first['takeaway'], 'topic': first['topic']}]}
        else:
            # 0.9.2: a multi-paragraph section is asked per unit (id#n); reuse the recorded section item.
            answer = {'sections': [dict(self.items.get(i) or self.items[i.split('#')[0]], id=i, evidence=[0]) for i in ids]}
        # The recorded model fenced its JSON; keep that defect in follow-ups.
        return iter(['```json\n' + json.dumps(answer, ensure_ascii=False) + '\n```'])


class LocalModelFoldingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        patcher = mock.patch.dict(os.environ, {'STENOAI_USER_DATA_DIR': self.temp.name})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.fixture = json.loads(FIXTURE.read_text(encoding='utf-8'))
        self.request = self.fixture['request']

    def provider(self, model):
        # Cloud-shaped boundary: _stream_completion is the single model call.
        provider = mock.Mock(ai_provider='cloud', model_name='recorded')
        provider._stream_completion.side_effect = model
        return provider

    def test_recorded_local_model_output_prepares_every_section(self):
        from src.summary_folding import prepare_folding
        original = copy.deepcopy(self.request)
        model = RecordedModel(self.fixture)
        result = prepare_folding(self.request, self.provider(model))
        self.assertEqual(self.request, original, 'source request must stay untouched')
        self.assertEqual([s['id'] for s in result['sections']], [s['id'] for s in original['sections']])
        for section, source in zip(result['sections'], original['sections']):
            self.assertEqual(section['full'], source['full'])
            content = [u for u in section['units'] if 'lad' in u]
            self.assertTrue(content, section['id'])
            for unit in content:
                lad = unit['lad']
                self.assertTrue(1 <= len(lad['ev']) <= 3, section['id'])
                self.assertEqual(lad['ev'], sorted(set(lad['ev'])))
                self.assertTrue(all(0 <= i < len(unit['sents']) for i in lad['ev']))
                self.assertTrue(lad['brief'] and 0 < lad['tn'] <= len(lad['brief']) and lad['topic'])
        distinct = {item['id'] for payload in model.payloads for item in payload}
        self.assertLessEqual(len(model.payloads), 3 * -(-len(distinct) // 4), 'retries stay bounded per unit batch')

    def test_markdown_fence_and_think_block_are_unwrapped_but_inner_json_stays_strict(self):
        from src.summary_folding import parse_model_json
        body = '{"sections":[]}'
        self.assertEqual(parse_model_json('```json\n' + body + '\n```'), {'sections': []})
        self.assertEqual(parse_model_json('<think>plan</think>\n```\n' + body + '\n```'), {'sections': []})
        self.assertEqual(parse_model_json('  ' + body + '\n'), {'sections': []})
        for bad in ('Hier is het:\n```json\n' + body + '\n```', '```json\n' + body + '\n``` extra',
                    '```json\n{"sections":[],"sections":[]}\n```', '```json\n{"a":NaN}\n```',
                    '```json\n' + body, body + ' trailing'):
            with self.subTest(bad=bad[:30]):
                with self.assertRaises(ValueError):
                    parse_model_json(bad)

    def test_evidence_overflow_keeps_three_valid_indices_in_source_order(self):
        from src.summary_folding import prepare_folding
        request = {'schemaVersion': 2, 'sourceHash': 'b' * 64, 'sections': [
            {'id': 's', 'title': 'T', 'full': 'Een. Twee. Drie. Vier. Vijf.'}]}
        answer = {'sections': [{'id': 's', 'evidence': [4, 99, 1, 1, 3, 0], 'key': 'K.', 'takeaway': 'T.', 'topic': 'O'}]}
        provider = mock.Mock(ai_provider='cloud')
        provider._stream_completion.return_value = iter([json.dumps(answer)])
        section = prepare_folding(request, provider)['sections'][0]
        self.assertEqual(section['units'][0]['lad']['ev'], [1, 3, 4])
        self.assertEqual(ev_text(section['units'][0]), ['Twee.', 'Vier.', 'Vijf.'])

    def test_missing_section_is_requested_again_without_resending_answered_sections(self):
        from src.summary_folding import prepare_folding
        request = {'schemaVersion': 2, 'sourceHash': 'c' * 64, 'sections': [
            {'id': 'a', 'title': 'A', 'full': 'Alfa een. Alfa twee.'},
            {'id': 'b', 'title': 'B', 'full': 'Beta een. Beta twee.'}]}
        item = lambda i: {'id': i, 'evidence': [0], 'key': i + '.', 'takeaway': i + '.', 'topic': i}
        calls = []

        def respond(prompt):
            payload = json.loads(prompt.split('SOURCE DATA:\n', 1)[1])
            calls.append([s['id'] for s in payload])
            return iter([json.dumps({'sections': [item('a')]} if len(calls) == 1 else {'sections': [item('b')]})])

        provider = mock.Mock(ai_provider='cloud')
        provider._stream_completion.side_effect = respond
        result = prepare_folding(request, provider)
        self.assertEqual(calls, [['a', 'b'], ['b']])
        self.assertEqual([plain(unit0(result, n)['lad']['brief'], {}) for n in (0, 1)], ['a.', 'b.'])

    def test_unrecoverable_structure_fails_with_content_free_reason_after_bounded_attempts(self):
        from src.summary_folding import FoldError, prepare_folding
        request = {'schemaVersion': 2, 'sourceHash': 'd' * 64, 'sections': [
            {'id': 'a', 'title': 'A', 'full': 'Alfa een.'}, {'id': 'b', 'title': 'B', 'full': 'Beta een.'}]}
        provider = mock.Mock(ai_provider='cloud')
        provider._stream_completion.side_effect = lambda prompt: iter(['SECRET prose, no JSON'])
        with self.assertRaises(FoldError) as caught:
            prepare_folding(request, provider)
        self.assertEqual(caught.exception.reason, 'invalid_structure')
        self.assertNotIn('SECRET', str(caught.exception))
        self.assertLessEqual(provider._stream_completion.call_count, 6)

    def test_provider_failure_and_oversized_source_have_distinct_reasons(self):
        from src.summary_folding import FoldError, prepare_folding
        request = {'schemaVersion': 2, 'sourceHash': 'e' * 64, 'sections': [{'id': 'a', 'title': 'A', 'full': 'Alfa.'}]}
        provider = mock.Mock(ai_provider='cloud')
        provider._stream_completion.side_effect = ConnectionError('SECRET host')
        with self.assertRaises(FoldError) as caught:
            prepare_folding(request, provider)
        self.assertEqual(caught.exception.reason, 'provider_unavailable')
        self.assertEqual(provider._stream_completion.call_count, 1, 'an unreachable provider is not hammered')
        too_long = dict(request, sections=[{'id': 'a', 'title': '', 'full': 'x' * 96001}])
        with self.assertRaises(FoldError) as caught:
            prepare_folding(too_long, provider)
        self.assertEqual(caught.exception.reason, 'too_long')

    def test_markdown_lists_headings_and_abbreviations_split_into_whole_sentences(self):
        from src.textfold_ladder import parse_units
        from src.textfold_tokens import split_sentences, tokenize_text
        full = ('#### Planning en budget\n'
                '1. Eerst testen we de koppeling. Daarna volgt de pilot.\n'
                '- **Budget**: ca. \u20ac 1,2 mln. voor bijv. licenties en o.a. training.\n'
                '- Deadline is 15 mrt. 2027, zegt Anouk. Dirk twijfelt!\n'
                '---\n'
                'Volgens dr. Jansen is dat haalbaar.')
        out = []
        for unit in parse_units(full):
            toks = tokenize_text(unit['full'])
            out.append((unit['kind'], [plain(toks[a:b], {}) for a, b in split_sentences(toks)]))
        self.assertEqual(out, [
            ('heading', ['Planning en budget']),
            ('item', ['Eerst testen we de koppeling.', 'Daarna volgt de pilot.']),
            ('item', ['Budget: ca. \u20ac 1,2 mln. voor bijv. licenties en o.a. training.']),
            ('item', ['Deadline is 15 mrt. 2027, zegt Anouk.', 'Dirk twijfelt!']),
            ('paragraph', ['Volgens dr. Jansen is dat haalbaar.'])])

    def test_heading_units_carry_no_ladder_and_out_of_range_evidence_is_dropped(self):
        from src.summary_folding import prepare_folding
        request = {'schemaVersion': 2, 'sourceHash': 'f' * 64, 'sections': [
            {'id': 's', 'title': 'T', 'full': '### Kop\nInhoud een. Inhoud twee.'}]}
        answer = {'sections': [{'id': 's', 'evidence': [1, 7], 'key': 'K.', 'takeaway': 'T.', 'topic': 'O'}]}
        provider = mock.Mock(ai_provider='cloud')
        provider._stream_completion.return_value = iter([json.dumps(answer)])
        units = prepare_folding(request, provider)['sections'][0]['units']
        self.assertEqual([u['kind'] for u in units], ['heading', 'paragraph'])
        self.assertNotIn('lad', units[0])
        self.assertEqual(ev_text(units[1]), ['Inhoud twee.'])

    def test_ollama_requests_the_json_schema_and_falls_back_when_format_is_rejected(self):
        from src.summary_folding import RESPONSE_SCHEMA, prepare_folding
        request = {'schemaVersion': 2, 'sourceHash': 'a' * 64, 'sections': [{'id': 's', 'title': 'T', 'full': 'Een. Twee.'}]}
        answer = json.dumps({'sections': [{'id': 's', 'evidence': [1], 'key': 'K.', 'takeaway': 'T.', 'topic': 'O'}]})
        provider = mock.Mock(ai_provider='local', model_name='gemma4:e2b-nvfp4')
        provider._ollama_options.return_value = {'num_ctx': 32768}
        seen = []

        def chat(client, **kwargs):
            seen.append(kwargs)
            if 'format' in kwargs:
                raise RuntimeError('old server rejects format')
            yield {'message': {'content': answer}}

        provider._chat_stream_no_think.side_effect = chat
        result = prepare_folding(request, provider)
        self.assertEqual(ev_text(unit0(result)), ['Twee.'])
        self.assertEqual(seen[0]['format'], RESPONSE_SCHEMA)
        self.assertEqual(seen[0]['options'], {'num_ctx': 32768})
        self.assertNotIn('format', seen[1])
        self.assertEqual(seen[0]['model'], 'gemma4:e2b-nvfp4')
        provider._stream_completion.assert_not_called()

    def test_cli_reports_progress_and_reason_without_content(self):
        from click.testing import CliRunner
        import simple_recorder
        model = RecordedModel(self.fixture)
        provider = self.provider(model)
        with mock.patch.object(simple_recorder, 'OllamaSummarizer', return_value=provider):
            result = CliRunner().invoke(simple_recorder.cli, ['summary-fold', '--progress'],
                                        input=json.dumps(self.request))
        self.assertEqual(result.exit_code, 0, result.output)
        progress = [json.loads(line) for line in result.stderr.splitlines()]
        self.assertTrue(progress)
        for line in progress:
            self.assertEqual(set(line), {'progress'})
            self.assertEqual(set(line['progress']), {'done', 'total'})
            self.assertLessEqual(line['progress']['done'], line['progress']['total'])
        self.assertEqual(progress[-1]['progress']['done'], progress[-1]['progress']['total'])
        self.assertNotIn('ERP', result.stderr)
        self.assertEqual(len(json.loads(result.stdout)['sections']), len(self.request['sections']))
        failing = mock.Mock(ai_provider='cloud')
        failing._stream_completion.side_effect = lambda prompt: iter(['SECRET nonsense'])
        with mock.patch.object(simple_recorder, 'OllamaSummarizer', return_value=failing):
            result = CliRunner().invoke(simple_recorder.cli, ['summary-fold'], input=json.dumps(self.request))
        self.assertEqual(result.exit_code, 1)
        self.assertEqual(json.loads(result.stdout)['reason'], 'invalid_structure')
        self.assertNotIn('SECRET', result.output)
        with mock.patch.object(simple_recorder, 'OllamaSummarizer', side_effect=ConnectionError('SECRET')):
            result = CliRunner().invoke(simple_recorder.cli, ['summary-fold'], input=json.dumps(self.request))
        self.assertEqual(json.loads(result.stdout)['reason'], 'provider_unavailable')


    def test_preparing_levels_never_downloads_a_model(self):
        """An explicit fold must not turn into a multi-gigabyte model pull."""
        from click.testing import CliRunner
        import simple_recorder
        import src.summarizer as summarizer_module
        fake_ollama = mock.Mock()
        attempted = []

        def construct():
            # The real constructor pulls when the configured model is missing.
            try:
                summarizer_module.ollama.pull('gemma4:e2b-nvfp4')
            except Exception:
                attempted.append('blocked')
                raise RuntimeError('model missing')
            return self.provider(RecordedModel(self.fixture))

        with mock.patch.object(summarizer_module, 'ollama', fake_ollama), \
                mock.patch.object(simple_recorder, 'OllamaSummarizer', side_effect=construct):
            result = CliRunner().invoke(simple_recorder.cli, ['summary-fold'], input=json.dumps(self.request))
            self.assertIs(summarizer_module.ollama, fake_ollama)
        fake_ollama.pull.assert_not_called()
        self.assertEqual(attempted, ['blocked'])
        self.assertEqual(json.loads(result.stdout)['reason'], 'provider_unavailable')

if __name__ == '__main__':
    unittest.main()
