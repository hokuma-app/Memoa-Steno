"""0.10.2: action items keep their task text, never invent a deadline, and agree across parsers."""

import json
import os
import unittest
from pathlib import Path

from simple_recorder import MeetingPipeline, _action_items_as_tasks
from src.action_items import parse_action_entries, strip_unsupported_due_dates

CASES = json.loads((Path(__file__).parent / "fixtures" / "action_item_cases.json").read_text(encoding="utf-8"))


def _items(entries):
    out = []
    for entry in entries:
        out.append(entry.text)
        for nested in entry.nested:
            out.append(nested)
    return out


class SharedCaseTests(unittest.TestCase):
    def test_every_shared_case_gives_the_expected_items(self):
        for case in CASES:
            with self.subTest(case["name"]):
                entries, dropped = parse_action_entries(case["lines"])
                items = [entry.text for entry in entries]
                for entry in entries:
                    items += [n for n in entry.nested]
                self.assertEqual(items, case["items"])
                self.assertEqual(dropped, case.get("dropped", 0))


class RewriteTests(unittest.TestCase):
    def test_owner_and_due_without_task_get_the_task_from_the_next_line(self):
        md = "## Action Items\n- **Speaker 2** (due 2026-10-30)\n  Stuur de offerte\n- Verstuur het verslag\n"
        out = _action_items_as_tasks(md)
        self.assertIn("- [ ] Speaker 2: Stuur de offerte (due 2026-10-30)", out)
        self.assertIn("- [ ] Verstuur het verslag", out)
        self.assertEqual(out.count("- [ ]"), 2)

    def test_item_without_any_task_is_left_out_and_nothing_else_changes(self):
        md = "## Summary\nKort.\n\n## Action Items\n- Speaker 2 (due 2026-10-30)\n- Management (due 2026-10-30)\n\n## Next\n- x\n"
        out = _action_items_as_tasks(md)
        self.assertNotIn("Speaker 2", out)
        self.assertNotIn("Management", out)
        self.assertIn("## Summary\nKort.", out)
        self.assertIn("## Next\n- x", out)

    def test_nested_bullets_under_a_task_stay_in_the_file(self):
        out = _action_items_as_tasks("## Action Items\n- [ ] Already a task\n  - nested detail stays\n")
        self.assertIn("- [ ] Already a task\n  - nested detail stays", out)

    def test_task_state_survives_a_merge(self):
        out = _action_items_as_tasks("## Action Items\n- [x] **Anna** (due 2026-10-20)\n  Deel de slides\n")
        self.assertIn("- [x] Anna: Deel de slides (due 2026-10-20)", out)


class ParserTests(unittest.TestCase):
    def test_streamed_parser_merges_the_continuation(self):
        md = "## Action Items\n- [ ] Speaker 2 (due 2026-10-30)\n  Bel de klant\n- Budget bijwerken\n"
        parsed = MeetingPipeline._parse_streamed_markdown(md)
        self.assertEqual(parsed["action_items"], ["Speaker 2: Bel de klant (due 2026-10-30)", "Budget bijwerken"])

    def test_saved_note_parser_shows_task_text_for_martins_five_lines(self):
        import tempfile

        from simple_recorder import _parse_meeting_markdown

        body = (
            "---\ntitle: Test\ndate: 2026-10-30\n---\n## Summary\nKort.\n\n## Action Items\n"
            "- [ ] **Speaker 2** (due 2026-10-30)\n  Stuur de offerte naar de klant\n"
            "- [ ] Speaker 2 (due 2026-10-30)\n  - Plan de demo in\n"
            "- [ ] **Team members** (due 2026-10-30)\n  Controleer de planning\n"
            "- [ ] Management (due 2026-10-30)\n  Besluit over het budget\n"
            "- [ ] Team members (due 2026-10-30)\n  Meld afwijkingen\n\n## Transcript\nx\n"
        )
        with tempfile.TemporaryDirectory(dir=os.environ["TMPDIR"]) as tmp:
            path = Path(tmp) / "a_summary.md"
            path.write_text(body, encoding="utf-8")
            parsed = _parse_meeting_markdown(path)
        self.assertEqual(parsed["action_items"], [
            "Speaker 2: Stuur de offerte naar de klant (due 2026-10-30)",
            "Speaker 2: Plan de demo in (due 2026-10-30)",
            "Team members: Controleer de planning (due 2026-10-30)",
            "Management: Besluit over het budget (due 2026-10-30)",
            "Team members: Meld afwijkingen (due 2026-10-30)",
        ])


class DueDateTests(unittest.TestCase):
    TODAY = "2026-10-30"

    def _strip(self, item, transcript):
        out, removed = strip_unsupported_due_dates([item], transcript, self.TODAY)
        return out[0], removed

    def test_meeting_date_without_today_wording_is_removed(self):
        item, removed = self._strip("Anna: stuur de offerte (due 2026-10-30)", "Anna zegt dat zij de offerte stuurt.")
        self.assertEqual(item, "Anna: stuur de offerte")
        self.assertEqual(removed, 1)

    def test_meeting_date_with_today_wording_is_kept(self):
        for said in ("Ik doe het vandaag nog.", "Ik stuur het vanavond.", "Done by end of the day.", "Ik regel het eind van de dag."):
            with self.subTest(said):
                item, removed = self._strip("Anna: stuur de offerte (due 2026-10-30)", said)
                self.assertEqual((item, removed), ("Anna: stuur de offerte (due 2026-10-30)", 0))

    def test_resolved_weekday_is_kept(self):
        item, removed = self._strip("Piet: stuur het budget (due 2026-11-06)", "Piet: ik stuur het budget vrijdag.")
        self.assertEqual((item, removed), ("Piet: stuur het budget (due 2026-11-06)", 0))

    def test_no_deadline_language_at_all_removes_every_date(self):
        item, removed = self._strip("Piet: stuur het budget (due 2026-11-06)", "We bespraken de planning en het budget.")
        self.assertEqual((item, removed), ("Piet: stuur het budget", 1))

    def test_date_in_the_past_is_removed(self):
        item, removed = self._strip("Piet: stuur het budget (due 2026-10-02)", "Ik stuur het budget vrijdag.")
        self.assertEqual((item, removed), ("Piet: stuur het budget", 1))

    def test_may_and_decimal_numbers_are_not_dates(self):
        item, removed = self._strip("Piet: stuur het (due 2026-11-06)", "We may use version 3.5 of the tool.")
        self.assertEqual(removed, 1)

    def test_items_without_a_date_are_untouched(self):
        out, removed = strip_unsupported_due_dates(["Gewoon een taak"], "", self.TODAY)
        self.assertEqual((out, removed), (["Gewoon een taak"], 0))

    def test_unknown_meeting_date_still_requires_deadline_language(self):
        out, removed = strip_unsupported_due_dates(["A: x (due 2026-11-06)"], "Geen datum genoemd.", None)
        self.assertEqual((out, removed), (["A: x"], 1))

    def test_rewrite_applies_the_filter_when_the_transcript_is_given(self):
        md = "## Action Items\n- Anna: stuur de offerte (due 2026-10-30)\n"
        out = _action_items_as_tasks(md, transcript="Anna stuurt de offerte.", meeting_date=self.TODAY)
        self.assertIn("- [ ] Anna: stuur de offerte\n", out + "\n")
        self.assertNotIn("due", out)
        kept = _action_items_as_tasks(md)
        self.assertIn("(due 2026-10-30)", kept)


class PromptTests(unittest.TestCase):
    def test_rules_show_all_outcomes_and_forbid_the_meeting_date_and_split_lines(self):
        from src.summarizer import _action_item_rules

        for rules in (_action_item_rules("2026-10-30"), _action_item_rules(None)):
            self.assertIn("never write only a name and a date", rules)
            self.assertIn("never put the task on a second line", rules)
            self.assertIn("never write the date of the meeting", rules)
            # Examples with every outcome, so a small model does not copy a single shape.
            self.assertIn("-> \"- Emma: send the offer to the client (due friday)\"", rules)
            self.assertIn("-> \"- Jan: book the room\"", rules)
            self.assertIn("-> \"- update the planning\"", rules)
            self.assertIn("-> \"- Speaker 2: call the supplier\"", rules)
        # The example date is never the real meeting date.
        self.assertNotIn("2026-10-30)", _action_item_rules("2026-10-30"))


if __name__ == "__main__":
    unittest.main()
