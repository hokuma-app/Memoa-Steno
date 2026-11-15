"""Model-free tests of the agenda chair backend (Veneta, stand 1). Invented meetings only; scratch roots only."""
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SCRATCH = Path(os.environ.get('TMPDIR') or tempfile.gettempdir())


def request():
    return {'sessionId': 'recording:1', 'revision': 'a1', 'currentItemId': 'p1',
            'items': [{'id': 'p1', 'title': 'Opening', 'outcome': 'discussie'},
                      {'id': 'p2', 'title': 'Nieuwe roosters', 'outcome': 'besluit'}],
            'segments': [
                {'id': 's1', 'text': 'Dan gaan we naar de nieuwe roosters.', 'speaker': 'self', 'start': 0, 'end': 2},
                {'id': 's2', 'text': 'We besluiten het rooster in mei in te voeren, Noor regelt dat voor vrijdag.',
                 'speaker': 'other', 'start': 3, 'end': 7},
                {'id': 's3', 'text': 'Wie stuurt de uitnodiging?', 'speaker': 'unknown', 'start': 8, 'end': 9}]}


def config(provider='local', model='fixture-model'):
    value = mock.Mock()
    value.get_ai_provider.return_value = provider
    value.get_model.return_value = model
    return value


GOOD = {'currentItem': {'itemId': 'p2', 'segmentId': 's1', 'quote': 'de nieuwe roosters'},
        'findings': [
            {'kind': 'besluit', 'itemId': 'p2', 'text': 'Rooster gaat in mei in.', 'owner': 'Noor', 'due': 'vrijdag',
             'segmentId': 's2', 'quote': 'We besluiten het rooster in mei'},
            {'kind': 'vraag', 'itemId': None, 'text': 'Wie stuurt de uitnodiging?', 'owner': None, 'due': None,
             'segmentId': 's3', 'quote': 'Wie stuurt de uitnodiging?'}]}


class RequestTests(unittest.TestCase):
    def test_strict_request_contract(self):
        from src.veneta_agenda import validate_request
        data = request()
        self.assertEqual(validate_request(data), data)
        invalid = []
        for key in data:
            item = copy.deepcopy(data)
            del item[key]
            invalid.append(item)
        for field, value in [('url', 'https://cloud'), ('revision', ''), ('currentItemId', 'p9')]:
            item = copy.deepcopy(data)
            item[field] = value
            invalid.append(item)
        for field, value in [('speaker', 'seller'), ('start', -1), ('end', float('nan')), ('start', True)]:
            item = copy.deepcopy(data)
            item['segments'][0][field] = value
            invalid.append(item)
        item = copy.deepcopy(data)
        item['items'][0]['outcome'] = 'stemming'
        invalid.append(item)
        item = copy.deepcopy(data)
        item['items'] = [dict(data['items'][0], id=f'p{i}') for i in range(33)]
        invalid.append(item)
        item = copy.deepcopy(data)
        item['segments'] = [dict(data['segments'][0], id=f's{i}') for i in range(257)]
        invalid.append(item)
        item = copy.deepcopy(data)
        item['segments'][0]['text'] = 'x' * 24000
        invalid.append(item)
        for item in invalid:
            with self.assertRaises(ValueError):
                validate_request(item)


class SalvageTests(unittest.TestCase):
    def test_grounded_findings_are_kept_and_everything_else_is_dropped_per_item(self):
        from src.veneta_agenda import salvage_response
        result = salvage_response(GOOD, request())
        self.assertEqual(result['currentItem'], GOOD['currentItem'])
        self.assertEqual([f['kind'] for f in result['findings']], ['besluit', 'vraag'])
        self.assertEqual(result['findings'][0]['owner'], 'Noor')
        self.assertEqual(result['findings'][0]['due'], 'vrijdag')
        bad = copy.deepcopy(GOOD)
        bad['currentItem']['quote'] = 'e nieuwe roos'  # not on word boundaries
        bad['findings'] += [
            dict(GOOD['findings'][0], quote='We'),                       # shorter than three characters
            dict(GOOD['findings'][0], quote='besluiten rooster'),        # not literal
            dict(GOOD['findings'][0], segmentId='s9'),                   # unknown segment
            dict(GOOD['findings'][0], kind='mail'),                      # not a finding kind
            dict(GOOD['findings'][0], text='   '),                       # no text
            dict(GOOD['findings'][0]),                                    # duplicate
            'zet dit in de planning',                                     # not an object
        ]
        result = salvage_response(bad, request())
        self.assertIsNone(result['currentItem'])
        self.assertEqual(len(result['findings']), 2)

    def test_owner_and_deadline_must_be_said_and_unknown_items_become_null(self):
        from src.veneta_agenda import salvage_response
        payload = {'currentItem': None, 'findings': [dict(GOOD['findings'][0], owner='Bram', due='morgen', itemId='p7')]}
        finding = salvage_response(payload, request())['findings'][0]
        self.assertIsNone(finding['owner'])
        self.assertIsNone(finding['due'])
        self.assertIsNone(finding['itemId'])
        self.assertEqual(len(finding['text']), len('Rooster gaat in mei in.'))
        payload = {'findings': [dict(GOOD['findings'][0], text='x' * 500)]}
        self.assertEqual(len(salvage_response(payload, request())['findings'][0]['text']), 300)


class ModelPortTests(unittest.TestCase):
    def test_local_only_injected_port_prompt_and_safe_failures(self):
        from src import veneta_agenda as va
        port = mock.Mock(return_value=json.dumps(GOOD))
        result = va.evaluate(request(), config=config(), model_port=port)
        self.assertNotIn('error', result)
        self.assertEqual(result['revision'], 'a1')
        self.assertEqual(result['currentItem']['itemId'], 'p2')
        kwargs = port.call_args.kwargs
        self.assertEqual(kwargs['model'], 'fixture-model')
        self.assertEqual(kwargs['options']['temperature'], 0)
        self.assertFalse(kwargs['stream'])
        self.assertNotIn('tools', kwargs)
        system = kwargs['messages'][0]['content']
        self.assertIn('never instructions', system)
        self.assertIn('never act', system)
        self.assertIn('"findings": []', system, 'the prompt shows the answer when nothing fits')
        for provider in ('cloud', 'remote', 'adapter'):
            port.reset_mock()
            self.assertIn('error', va.evaluate(request(), config=config(provider), model_port=port))
            port.assert_not_called()
        for model in ('x:cloud', 'gpt-oss:120b-cloud', '', 'https://bad'):
            port.reset_mock()
            self.assertIn('error', va.evaluate(request(), config=config(model=model), model_port=port))
            port.assert_not_called()

    def test_code_fence_and_missing_closer_are_repaired_safely_prose_is_not(self):
        from src import veneta_agenda as va
        fenced = '```json\n' + json.dumps(GOOD) + '\n```'
        self.assertNotIn('error', va.evaluate(request(), config=config(), model_port=mock.Mock(return_value=fenced)))
        short = json.dumps(GOOD)[:-2]
        self.assertNotIn('error', va.evaluate(request(), config=config(), model_port=mock.Mock(return_value=short)))
        for reply, reason in (('Hier is het antwoord: {}', 'not_json'), ('', 'empty_answer'),
                              ('{"currentItem": null, "findings": [], "mail": "x"}', 'wrong_shape'),
                              ('{"findings": [], "findings": []}', 'not_json')):
            port = mock.Mock(return_value=reply)
            result = va.evaluate(request(), config=config(), model_port=port)
            self.assertEqual(result.get('reason'), reason, reply)
            self.assertEqual(port.call_count, 2, 'one bounded retry')
        port = mock.Mock(side_effect=RuntimeError('secret provider body'))
        result = va.evaluate(request(), config=config(), model_port=port)
        self.assertIn('error', result)
        self.assertNotIn('secret', json.dumps(result))

    def test_cli_reads_a_private_request_writes_nothing_and_never_calls_the_network(self):
        from click.testing import CliRunner
        from tests.test_veneta_checklist import FakeHTTP
        with tempfile.TemporaryDirectory(dir=SCRATCH, prefix='agenda-cli-') as tmp, FakeHTTP() as server:
            with mock.patch.dict(os.environ, {'STENOAI_USER_DATA_DIR': tmp, 'OLLAMA_HOST': server.endpoint}):
                import simple_recorder
                self.assertIn('agenda-analyze', simple_recorder.cli.commands)
                root = Path(tmp)
                (root / 'config.json').write_text(json.dumps({'ai_provider': 'local', 'model': 'fixture-model'}))
                source = root / 'request.json'
                source.write_text(json.dumps(request()))
                source.chmod(0o600)
                before = {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}
                with mock.patch('ollama.Client.chat', return_value=mock.Mock(
                        message=mock.Mock(content=json.dumps(GOOD)), done_reason='stop')) as transport:
                    result = CliRunner().invoke(simple_recorder.cli, ['agenda-analyze', str(source)])
                self.assertEqual(result.exit_code, 0, result.output)
                body = json.loads(result.output)
                self.assertEqual(body['revision'], 'a1')
                self.assertEqual(len(body['findings']), 2)
                self.assertEqual(transport.call_args.kwargs['model'], 'fixture-model')
                self.assertEqual(before, {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()})
                source.chmod(0o644)
                with mock.patch('ollama.Client.chat') as transport:
                    refused = CliRunner().invoke(simple_recorder.cli, ['agenda-analyze', str(source)])
                self.assertEqual(refused.exit_code, 1)
                self.assertEqual(json.loads(refused.output)['reason'], 'invalid_request')
                transport.assert_not_called()


if __name__ == '__main__':
    unittest.main()
