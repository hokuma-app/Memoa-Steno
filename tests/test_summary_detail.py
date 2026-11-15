"""Summary preferences affect future generation only, in isolated storage."""
import os
import tempfile
import unittest
from unittest import mock


class SummaryDetailTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.env = mock.patch.dict(os.environ, {"STENOAI_USER_DATA_DIR": self.temp.name})
        self.env.start()
        self.addCleanup(self.env.stop)
        from src.config import Config
        self.config = Config()
        self.config_patch = mock.patch('src.config.get_config', return_value=self.config)
        self.config_patch.start()
        self.addCleanup(self.config_patch.stop)

    def test_default_and_strict_round_trip(self):
        getter = getattr(self.config, 'get_summary_detail', None)
        self.assertTrue(callable(getter), 'Config needs the summary detail preference')
        self.assertEqual(getter(), 'detailed')
        for value in ('brief', 'balanced', 'detailed'):
            self.assertTrue(self.config.set_summary_detail(value))
            from src.config import Config
            self.assertEqual(Config().get_summary_detail(), value)
        before = dict(self.config._config)
        for value in ('', 'DETAILED', None, [], True, 'detailed '):
            self.assertFalse(self.config.set_summary_detail(value))
            self.assertEqual(self.config._config, before)


    def test_all_generation_prompts_follow_current_detail_without_global_mutation(self):
        from src.summarizer import OllamaSummarizer
        s = object.__new__(OllamaSummarizer)
        s.ollama_process = None
        builders = (
            lambda: s._create_permissive_prompt('SYNTHETIC SOURCE', 'en'),
            lambda: s._create_markdown_prompt('SYNTHETIC SOURCE', 'en'),
            lambda: s._create_template_report_prompt('SYNTHETIC SOURCE', 'Custom template', 'en'),
            lambda: s._create_reduce_prompt(['SYNTHETIC SOURCE'], 'en'),
            lambda: s._create_map_prompt('SYNTHETIC SOURCE', 1, 1),
        )
        with mock.patch('src.config.get_config', return_value=self.config):
            for level in ('detailed', 'brief', 'balanced', 'detailed'):
                self.config.set_summary_detail(level)
                for build in builders:
                    prompt = build()
                    self.assertIn('SUMMARY DETAIL: ' + level, prompt)
                    self.assertIn('SYNTHETIC SOURCE', prompt)
                    self.assertNotIn('6-8', prompt)
                    if level == 'detailed':
                        for term in ('arguments', 'decisions', 'uncertainties', 'Do not invent', 'no fixed item limit'):
                            self.assertIn(term, prompt)
                        self.assertNotIn('Brief analysis', prompt)
                        self.assertNotIn('Short paragraph', prompt)


    def test_cli_preferences_round_trip_and_never_touch_old_notes(self):
        from pathlib import Path
        from click.testing import CliRunner
        from simple_recorder import cli
        note = Path(self.temp.name) / 'output' / 'old.json'
        note.parent.mkdir(exist_ok=True)
        note.write_bytes(b'{"synthetic": "unchanged old note"}')
        runner = CliRunner()
        result = runner.invoke(cli, ['get-summary-detail'])
        self.assertEqual(result.exit_code, 0, result.output)
        import json
        self.assertEqual(json.loads(result.output), {'summary_detail': 'detailed'})
        for value in ('brief', 'balanced', 'detailed'):
            result = runner.invoke(cli, ['set-summary-detail', value])
            self.assertEqual(result.exit_code, 0, result.output)
            self.assertEqual(json.loads(result.output), {'summary_detail': value})
            result = runner.invoke(cli, ['get-summary-detail'])
            self.assertEqual(json.loads(result.output), {'summary_detail': value})
        result = runner.invoke(cli, ['set-summary-detail', 'SECRET-invalid'])
        self.assertNotEqual(result.exit_code, 0)
        self.assertNotIn('SECRET-invalid', result.output)
        self.assertEqual(note.read_bytes(), b'{"synthetic": "unchanged old note"}')


if __name__ == '__main__':
    unittest.main()
