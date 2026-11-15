"""Meeting-aware summary prompts (calendar, My notes, speakers) and the
owner/due-date action-item format."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.config import Config
from src.meeting_context import build_meeting_context
from src.summarizer import (
    MAP_CONTEXT_MAX_CHARS,
    MEETING_CONTEXT_MAX_CHARS,
    MEETING_CONTEXT_MIN_CHARS,
    OllamaSummarizer,
    _CHUNK_SAFETY_CHARS_PER_TOKEN,
)
from simple_recorder import _meeting_context_for_note
from tests.test_meeting_context import synthetic_event

STEM = "sysaudio-1792058617597-Note"
TRANSCRIPT = "[You] Shall we fix the launch scope?\n[Others] Piet will send the budget by Friday.\n"
NOTES = "Ask about pilot budget"


def _s(model="llama3.2:3b"):
    with mock.patch.object(OllamaSummarizer, "_ensure_ollama_ready", return_value=True):
        return OllamaSummarizer(model_name=model, ai_provider="local", config=Config())


def _captured_prompt(summarizer, **kwargs):
    """Run summarize_transcript_streaming with the provider stubbed out and
    return the single prompt it sent."""
    seen = []

    def fake_stream(prompt):
        seen.append(prompt)
        yield "## Summary\nok"

    with mock.patch.object(summarizer, "_stream_completion", side_effect=fake_stream):
        list(summarizer.summarize_transcript_streaming(TRANSCRIPT, 10, "en", **kwargs))
    assert len(seen) == 1
    return seen[0]


class NoteContextTests(unittest.TestCase):
    """simple_recorder._meeting_context_for_note against a synthetic output dir."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.summary = Path(self.tmp.name) / f"{STEM}_summary.md"
        self.profiles = mock.patch("src.config.get_config")
        get_config = self.profiles.start()
        get_config.return_value.get_person_profiles.return_value = [
            {"display_name": "Bram Spreker", "prototypes": [{"meeting_id": STEM}]},
            {"display_name": "Other Meeting", "prototypes": [{"meeting_id": "elsewhere"}]},
        ]

    def tearDown(self):
        self.profiles.stop()
        self.tmp.cleanup()

    def _write_calendar(self, event):
        (Path(self.tmp.name) / f"{STEM}_calendar.json").write_text(
            json.dumps({"checked_at": "2026-10-15T08:00:00Z", "event": event}), encoding="utf-8")

    def test_with_calendar_file_prompt_names_attendees_and_purpose(self):
        self._write_calendar(synthetic_event())
        ctx = _meeting_context_for_note(self.summary, participants=["Joke Notitie"])
        prompt = _captured_prompt(_s(), notes=NOTES, meeting_context=ctx)
        for expected in ("Q4 roadmap review", "Decide the Q4 launch scope", "Anna de Vries",
                         "piet.jansen", "Recorded by: Sam Recorder", "Bram Spreker",
                         "Joke Notitie", "USER NOTES", NOTES, "2026-10-15"):
            self.assertIn(expected, prompt)
        self.assertNotIn("Other Meeting", prompt)
        # Context comes before the transcript, which is unchanged.
        self.assertLess(prompt.index("MEETING CONTEXT"), prompt.index("TRANSCRIPT:"))
        self.assertIn(TRANSCRIPT, prompt)

    def test_without_calendar_file(self):
        ctx = _meeting_context_for_note(self.summary)
        self.assertIsNotNone(ctx)  # confirmed speaker + date from the stem
        self.assertIsNone(ctx.title)
        prompt = _captured_prompt(_s(), notes=NOTES, meeting_context=ctx)
        self.assertIn("Bram Spreker", prompt)
        self.assertNotIn("Invited:", prompt)
        self.assertNotIn("Invitation / agenda", prompt)
        self.assertIn(NOTES, prompt)

    def test_nothing_known_leaves_prompt_as_before(self):
        self.profiles.stop()
        with mock.patch("src.config.get_config") as get_config:
            get_config.return_value.get_person_profiles.return_value = []
            ctx = _meeting_context_for_note(Path(self.tmp.name) / "imported_summary.md")
        self.profiles.start()
        self.assertIsNone(ctx)
        s = _s()
        self.assertEqual(_captured_prompt(s, notes=NOTES, meeting_context=ctx),
                         _captured_prompt(s, notes=NOTES))
        self.assertNotIn("MEETING CONTEXT", _captured_prompt(s, notes=NOTES))

    def test_unreadable_profiles_do_not_break_context(self):
        self._write_calendar(synthetic_event())
        self.profiles.stop()
        with mock.patch("src.config.get_config", side_effect=RuntimeError("boom")):
            ctx = _meeting_context_for_note(self.summary)
        self.profiles.start()
        self.assertEqual(ctx.title, "Q4 roadmap review")
        self.assertEqual(ctx.speakers, [])

    def test_very_long_invitation_respects_local_budget(self):
        self._write_calendar(synthetic_event(description="Long background text. " * 20000))
        ctx = _meeting_context_for_note(self.summary)
        s = _s("llama3.2:3b")  # 8K window
        budget = s._meeting_context_budget_chars()
        self.assertEqual(budget, int(8192 * 0.08 * _CHUNK_SAFETY_CHARS_PER_TOKEN))
        block = s._meeting_context_block(ctx)
        self.assertLessEqual(len(block.strip()), budget)
        self.assertIn("Anna de Vries", block)
        self.assertIn("Bram Spreker", block)
        prompt = _captured_prompt(s, meeting_context=ctx)
        self.assertIn(TRANSCRIPT, prompt)
        self.assertLess(len(prompt), len(TRANSCRIPT) + budget + 5000)


class BudgetAndChunkingTests(unittest.TestCase):
    def setUp(self):
        self.ctx = build_meeting_context(synthetic_event(description="x " * 50000), ["Bram"])

    def test_cloud_budget_is_fixed_maximum(self):
        s = _s()
        s.ai_provider = "cloud"
        self.assertEqual(s._meeting_context_budget_chars(), MEETING_CONTEXT_MAX_CHARS)

    def test_local_budget_clamped(self):
        for model in ("llama3.2:3b", "gemma4:e4b-it-qat"):
            budget = _s(model)._meeting_context_budget_chars()
            self.assertGreaterEqual(budget, MEETING_CONTEXT_MIN_CHARS)
            self.assertLessEqual(budget, 4000)

    def test_context_counts_towards_chunking_gate(self):
        s = _s("llama3.2:3b")
        limit_chars = int(8192 * 0.8 * _CHUNK_SAFETY_CHARS_PER_TOKEN)
        transcript = "a" * (limit_chars - 500)
        self.assertFalse(s._needs_chunking(transcript))
        self.assertTrue(s._needs_chunking(transcript, extra_chars=len(s._meeting_context_block(self.ctx))))

    def test_map_prompt_gets_names_line_and_chunks_shrink(self):
        s = _s("llama3.2:3b")
        line = s._map_context_line(self.ctx)
        self.assertTrue(0 < len(line) <= MAP_CONTEXT_MAX_CHARS)
        self.assertEqual(s._chunk_budget_chars(len(line)), s._chunk_budget_chars() - len(line))
        prompt = s._create_map_prompt("segment", 1, 3, line)
        self.assertIn("Participants:", prompt)
        self.assertIn("Meeting date: 2026-10-15", prompt)
        self.assertIn("Name: action (due <deadline as spoken>)", prompt)

    def test_map_reduce_passes_context_to_map_and_reduce(self):
        s = _s("llama3.2:3b")
        map_prompts, reduce_prompts = [], []

        def fake_chat(stream=False, **kwargs):
            content = kwargs["messages"][0]["content"]
            if stream:
                reduce_prompts.append(content)
                return iter([{"message": {"content": "## Summary\nok"}}])
            map_prompts.append(content)
            return {"message": {"content": "KEY POINTS\n- p"}}

        long_transcript = "[You] words about the launch.\n" * 2000
        with mock.patch.object(s, "_ensure_ollama_ready", return_value=True), \
                mock.patch.object(s.client, "chat", side_effect=fake_chat):
            out = "".join(s.summarize_transcript_streaming(
                long_transcript, 60, "en", meeting_context=self.ctx))
        self.assertIn("ok", out)
        self.assertGreater(len(map_prompts), 1)
        self.assertTrue(all("Participants:" in p for p in map_prompts))
        self.assertEqual(len(reduce_prompts), 1)
        self.assertIn("MEETING CONTEXT", reduce_prompts[0])
        self.assertIn("Q4 roadmap review", reduce_prompts[0])


class ActionItemRulesTests(unittest.TestCase):
    def test_markdown_prompt_carries_owner_and_due_rules(self):
        ctx = build_meeting_context(synthetic_event())
        prompt = _s()._create_markdown_prompt(TRANSCRIPT, "en", meeting_context=ctx)
        self.assertIn("- Name: action (due <deadline as spoken>)", prompt)
        self.assertIn("exactly as spoken", prompt)
        self.assertNotIn("against the meeting date", prompt)
        self.assertIn("Never guess an owner", prompt)
        # Headers the parser depends on are unchanged.
        for header in ("## Summary", "## Key Topics", "## Key Points", "## Action Items"):
            self.assertIn(header, prompt)

    def test_without_meeting_date_relative_dates_are_not_resolved(self):
        prompt = _s()._create_markdown_prompt(TRANSCRIPT, "en")
        self.assertIn("Do not calculate", prompt)
        self.assertNotIn("against the meeting date", prompt)

    def test_reduce_and_template_prompts_carry_rules(self):
        s = _s()
        ctx = build_meeting_context(synthetic_event())
        self.assertIn("Never guess an owner", s._create_reduce_prompt(["r"], meeting_context=ctx))
        template = s._create_template_report_prompt(TRANSCRIPT, "Write minutes.", meeting_context=ctx)
        self.assertIn("If the report lists action items", template)
        self.assertIn("Q4 roadmap review", template)

    def test_dutch_output_keeps_due_keyword(self):
        prompt = _s()._create_markdown_prompt(TRANSCRIPT, "nl")
        self.assertIn("Keep the word \"due\"", prompt)

    def test_json_prompt_includes_context(self):
        ctx = build_meeting_context(synthetic_event())
        prompt = _s()._create_permissive_prompt(TRANSCRIPT, "en", meeting_context=ctx)
        self.assertIn("Anna de Vries", prompt)
        self.assertIn("never guessed", prompt)


if __name__ == "__main__":
    unittest.main()
