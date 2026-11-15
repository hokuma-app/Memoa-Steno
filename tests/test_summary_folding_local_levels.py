"""0.9.2: all five levels exist at once through TextFold's local mode, without any model."""
import json
import unittest
from unittest import mock

from click.testing import CliRunner

REQUEST = {'schemaVersion': 2, 'sourceHash': 'a' * 64, 'sections': [
    {'id': 'overview', 'title': 'Samenvatting', 'full': 'Het team koos voor Ollama. Kosten blijven laag.\n\nTweede alinea volgt hier. Nog een zin.'},
    {'id': 'key-points', 'title': 'Kernpunten', 'full': '- Eerst testen met een pilot.\n- Budget bewaken elke maand.'}]}


class LocalLevelTests(unittest.TestCase):
    def test_local_document_has_token_ladders_for_every_content_unit_without_a_model(self):
        from src.summary_folding import local_document
        doc = local_document(REQUEST)
        self.assertEqual((doc['schemaVersion'], doc['provenance'], doc['sourceHash']), (2, 'local', 'a' * 64))
        units = [u for s in doc['sections'] for u in s['units']]
        self.assertEqual([u['kind'] for u in units], ['paragraph', 'paragraph', 'item', 'item'])
        for unit in units:
            lad = unit['lad']
            self.assertEqual((lad['model'], lad['ev']), ('local', [0]))
            self.assertTrue(lad['tn'] > 0 and lad['topic'])
        self.assertEqual(units[2]['marker'], '-')

    def test_local_cli_never_constructs_a_provider(self):
        import simple_recorder
        with mock.patch.object(simple_recorder, 'OllamaSummarizer') as factory:
            result = CliRunner().invoke(simple_recorder.cli, ['summary-fold', '--local'], input=json.dumps(REQUEST))
        self.assertEqual(result.exit_code, 0, result.output)
        factory.assert_not_called()
        self.assertEqual(json.loads(result.stdout)['provenance'], 'local')


if __name__ == '__main__':
    unittest.main()
