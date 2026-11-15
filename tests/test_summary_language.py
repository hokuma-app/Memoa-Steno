"""Summary language: its own setting, a build default that never overwrites a
choice, and prompts that ask for Dutch content. Model-free."""
import json
import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.config import Config
from src.summarizer import OllamaSummarizer
from src import summary_folding
import simple_recorder

ENV = Config.SUMMARY_LANGUAGE_DEFAULT_ENV


def _summarizer(config):
    with mock.patch.object(OllamaSummarizer, "_ensure_ollama_ready"):
        return OllamaSummarizer(model_name="llama3.2:3b", ai_provider="local", config=config)


class SummaryLanguageSettingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "config.json"

    def config(self):
        return Config(config_path=self.path)

    def test_without_a_choice_the_build_default_applies_and_nothing_is_written(self):
        config = self.config()
        before = self.path.read_text() if self.path.exists() else None
        with mock.patch.dict(os.environ, {ENV: "nl"}):
            self.assertEqual(config.get_summary_language(), "nl")
            self.assertTrue(config.summary_language_is_default())
        after = self.path.read_text() if self.path.exists() else None
        self.assertEqual(before, after)
        if after is not None:
            self.assertNotIn("summary_language", json.loads(after))

    def test_default_build_keeps_following_the_meeting(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop(ENV, None)
            self.assertEqual(self.config().get_summary_language(), "auto")

    def test_an_explicit_choice_including_auto_wins_over_the_build_default(self):
        config = self.config()
        self.assertTrue(config.set_summary_language("auto"))
        with mock.patch.dict(os.environ, {ENV: "nl"}):
            self.assertEqual(self.config().get_summary_language(), "auto")
            self.assertFalse(self.config().summary_language_is_default())
        self.assertTrue(config.set_summary_language("en"))
        with mock.patch.dict(os.environ, {ENV: "nl"}):
            self.assertEqual(self.config().get_summary_language(), "en")

    def test_summary_language_is_separate_from_transcription_language(self):
        config = self.config()
        self.assertTrue(config.set_language("en"))
        self.assertTrue(config.set_summary_language("nl"))
        reloaded = self.config()
        self.assertEqual(reloaded.get_language(), "en")
        self.assertEqual(reloaded.get_summary_language(), "nl")

    def test_invalid_values_are_rejected_or_ignored(self):
        config = self.config()
        self.assertFalse(config.set_summary_language("klingon"))
        with mock.patch.dict(os.environ, {ENV: "klingon"}):
            self.assertEqual(self.config().get_summary_language(), "auto")
        config.set("summary_language", "klingon")
        self.assertEqual(self.config().get_summary_language(), "auto")


class ApplySummaryLanguageTests(unittest.TestCase):
    def test_pinned_language_replaces_the_meeting_language(self):
        self.assertEqual(simple_recorder.apply_summary_language("en", "nl"), "nl")

    def test_auto_and_missing_values_keep_the_meeting_language(self):
        for value in ("auto", "", None, mock.MagicMock()):
            self.assertEqual(simple_recorder.apply_summary_language("de", value), "de")

    def test_every_new_generation_path_applies_the_setting(self):
        # Live pipeline (two entry points), regenerate/Generate notes, template
        # report and title regeneration. Existing notes are only touched when
        # the user asks for one of these.
        source = Path(simple_recorder.__file__).read_text()
        self.assertEqual(len(re.findall(r"= apply_summary_language\(", source)), 5)


class DutchPromptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.summarizer = _summarizer(Config(config_path=Path(self.temp.name) / "config.json"))

    def test_standard_summary_asks_for_dutch_content_and_keeps_parser_headers(self):
        prompt = self.summarizer._create_markdown_prompt("[You] Hallo.\n[Others] Dag.", "nl")
        self.assertIn("topic titles, topic analysis, key points, action items) in Dutch", prompt)
        for header in ("## Summary", "## Key Topics", "## Key Points", "## Action Items"):
            self.assertIn(header, prompt)

    def test_long_meeting_reduce_step_asks_for_dutch(self):
        prompt = self.summarizer._create_reduce_prompt(["deel een", "deel twee"], "nl")
        self.assertIn("action items) in Dutch", prompt)

    def test_template_report_asks_for_dutch_headings_and_action_items(self):
        prompt = self.summarizer._create_template_report_prompt(
            "tekst", "Write the report in the language of the meeting.", "nl")
        self.assertIn("Write the report in Dutch, including its headings and action items", prompt)

    def test_title_prompt_asks_for_dutch(self):
        seen = {}

        def chat(prompt, timeout):
            seen["prompt"] = prompt
            return "Weekstart planning"

        self.summarizer.ai_provider = "cloud"
        with mock.patch.object(self.summarizer, "_cloud_chat", side_effect=chat):
            self.summarizer.generate_title("Een samenvatting.", "", "nl")
        self.assertIn("The title MUST be in Dutch.", seen["prompt"])

    def test_english_and_auto_add_no_language_instruction(self):
        for language in ("en", "auto"):
            self.assertNotIn("CRITICAL", self.summarizer._create_markdown_prompt("tekst", language))

    def test_detail_levels_stay_in_the_summary_language(self):
        self.assertIn("Use the source language", summary_folding._PROMPT)


if __name__ == "__main__":
    unittest.main()
