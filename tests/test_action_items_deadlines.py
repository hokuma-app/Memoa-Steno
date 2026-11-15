"""Deterministic deadlines in action items.

The model writes a deadline as spoken ("(due vrijdag)"); code converts known forms to
YYYY-MM-DD against the conversation date, keeps vague wording as text and never keeps a
date it computed itself. Fixtures mimic the measured output of gemma4:e2b-nvfp4 on a
synthetic Dutch conversation (conversation date Wednesday 2026-06-10, "vrijdag" is 2026-06-12).
"""
import unittest
from datetime import date
from typing import Optional

from simple_recorder import MeetingPipeline, _action_items_as_tasks
from src.action_items import (
    drop_unsupported_owners,
    resolve_deadline,
    strip_unsupported_due_dates,
)

WED = date(2026, 6, 10)

TRANSCRIPT = """[00:03] [Anna] Goedemorgen allemaal, we bespreken de planning van de klantdemo.
[00:12] [Piet] Ik heb de testomgeving gisteren klaargezet, die werkt nu.
[00:25] [Anna] Mooi. Piet, kun jij vrijdag de demo-omgeving nakijken en de resultaten naar het team sturen?
[00:34] [Piet] Ja, dat doe ik vrijdag.
[00:41] [Anna] Dan moet de klantvragenlijst nog worden bijgewerkt, maar daar heb ik geen eigenaar voor.
[00:55] [Speaker 2] Ik bel de leverancier over de levertijden, dat neem ik op me.
[01:05] [Anna] Prima. Verder niets, dan sluiten we af."""


class ResolveDeadlineTests(unittest.TestCase):
    def check(self, table, ref: Optional[date] = WED):
        for phrase, expected in table.items():
            with self.subTest(phrase=phrase, ref=ref):
                self.assertEqual(resolve_deadline(phrase, ref), expected)

    def test_relative_days(self):
        self.check({
            "vandaag": "2026-06-10", "today": "2026-06-10", "morgen": "2026-06-11", "tomorrow": "2026-06-11",
            "overmorgen": "2026-06-12", "Vandaag": "2026-06-10", "(morgen)": "2026-06-11",
        })

    def test_weekday_is_the_next_one_after_the_conversation_date(self):
        self.check({
            "vrijdag": "2026-06-12", "Friday": "2026-06-12", "donderdag": "2026-06-11", "maandag": "2026-06-15",
            "op vrijdag": "2026-06-12", "uiterlijk vrijdag": "2026-06-12", "komende vrijdag": "2026-06-12",
            "by Friday": "2026-06-12", "zondag": "2026-06-14",
        })

    def test_same_weekday_means_next_week(self):
        self.check({"woensdag": "2026-06-17", "wednesday": "2026-06-17"})

    def test_next_week_weekday(self):
        self.check({
            "volgende week dinsdag": "2026-06-16", "next week Tuesday": "2026-06-16",
            "volgende week vrijdag": "2026-06-19", "volgende week woensdag": "2026-06-17",
            "volgende week maandag": "2026-06-15", "volgende week zondag": "2026-06-21",
        })

    def test_next_week_weekday_from_a_sunday_uses_the_week_after(self):
        # 2026-06-14 is a Sunday; its calendar week ends that day, so 'next week Monday' is 06-15.
        self.check({"volgende week maandag": "2026-06-15", "vrijdag": "2026-06-19"}, ref=date(2026, 6, 14))

    def test_calendar_dates(self):
        self.check({
            "15 november": "2026-11-15", "15 nov": "2026-11-15", "15 november 2027": "2027-11-15",
            "3 maart": "2027-03-03", "10 juni": "2026-06-10", "1 januari 2027": "2027-01-01",
            "15th of November": "2026-11-15", "November 15": "2026-11-15", "november 15, 2027": "2027-11-15",
            "15-11": "2026-11-15", "15-11-2026": "2026-11-15", "15/11/2026": "2026-11-15",
            "15.11.2026": "2026-11-15", "2026-11-15": "2026-11-15", "5-3-27": "2027-03-05",
        })

    def test_invalid_dates_stay_unknown(self):
        self.check({"31 februari": None, "2026-02-30": None, "32 november": None, "15-13": None, "0 mei": None})

    def test_end_of_period_is_the_last_day(self):
        self.check({
            "eind van de maand": "2026-06-30", "einde van de maand": "2026-06-30", "end of the month": "2026-06-30",
            "eind van deze maand": "2026-06-30", "end of month": "2026-06-30",
        })

    def test_end_of_the_week_is_the_friday_of_the_work_week(self):
        # 2026-06-10 is a Wednesday: the Friday of that week is 06-12.
        self.check({
            "eind van de week": "2026-06-12", "end of the week": "2026-06-12", "eind van deze week": "2026-06-12",
            "einde van de week": "2026-06-12", "end of this week": "2026-06-12",
        }, ref=date(2026, 6, 10))
        self.check({"eind van de week": "2026-06-12"}, ref=date(2026, 6, 8))  # Monday
        self.check({"end of the week": "2026-06-12"}, ref=date(2026, 6, 11))  # Thursday

    def test_end_of_the_week_on_friday_or_later_is_next_weeks_friday(self):
        for ref in (date(2026, 6, 12), date(2026, 6, 13), date(2026, 6, 14)):  # Friday, Saturday, Sunday
            self.check({"eind van de week": "2026-06-19", "end of the week": "2026-06-19"}, ref=ref)

    def test_end_of_month_in_february_and_december(self):
        self.check({"eind van de maand": "2028-02-29"}, ref=date(2028, 2, 3))
        self.check({"eind van de maand": "2026-12-31"}, ref=date(2026, 12, 1))

    def test_vague_or_unknown_forms_are_never_guessed(self):
        self.check({
            "na de release": None, "soon": None, "binnenkort": None, "volgende week": None, "next week": None,
            "next Friday": None, "volgende maand": None, "eind volgende maand": None, "": None, "TBD": None,
            "after the release": None, "vrijdag of zo": None, "zodra de klant reageert": None,
        })

    def test_without_a_conversation_date_only_absolute_dates_convert(self):
        self.check({
            "vrijdag": None, "morgen": None, "vandaag": None, "volgende week dinsdag": None,
            "eind van de maand": None, "15 november": None, "15-11": None,
            "15 november 2026": "2026-11-15", "15-11-2026": "2026-11-15", "2026-11-15": "2026-11-15",
        }, ref=None)


class DueResolutionTests(unittest.TestCase):
    def run_items(self, items, transcript=TRANSCRIPT, ref="2026-06-10"):
        return strip_unsupported_due_dates(items, transcript, ref)

    def test_spoken_weekday_becomes_an_iso_date(self):
        out, removed = self.run_items(["Piet: de demo-omgeving nakijken (due vrijdag)"])
        self.assertEqual(out, ["Piet: de demo-omgeving nakijken (due 2026-06-12)"])
        self.assertEqual(removed, 0)

    def test_measured_wrong_weekday_date_is_never_kept(self):
        # gemma4 wrote Thursday for 'vrijdag'.
        out, removed = self.run_items(["Piet: de demo-omgeving nakijken (due 2026-06-11)"])
        self.assertNotIn("2026-06-11", out[0])
        self.assertEqual(out, ["Piet: de demo-omgeving nakijken"])
        self.assertEqual(removed, 1)

    def test_measured_conversation_date_is_removed(self):
        out, removed = self.run_items(["Piet: de demo-omgeving nakijken (due 2026-06-10)"])
        self.assertEqual(out, ["Piet: de demo-omgeving nakijken"])
        self.assertEqual(removed, 1)

    def test_correct_model_date_stays_when_a_deadline_word_in_the_line_gives_it(self):
        out, removed = self.run_items(["Piet: de demo-omgeving nakijken (due 2026-06-12)"])
        self.assertEqual((out, removed), (["Piet: de demo-omgeving nakijken (due 2026-06-12)"], 0))

    def test_model_date_supported_by_a_deadline_word_in_the_item_itself(self):
        out, removed = self.run_items(["Piet: vrijdag de resultaten sturen (due 2026-06-12)"], transcript="Ergens anders.\nNog iets vrijdag.")
        self.assertEqual(removed, 0)
        self.assertIn("(due 2026-06-12)", out[0])

    def test_model_date_not_supported_by_any_line_is_removed(self):
        transcript = "[00:01] [Anna] We spreken af dat Piet de offerte stuurt.\n[00:09] [Piet] Maandag bel ik de klant over iets anders."
        out, removed = self.run_items(["Piet: de offerte sturen (due 2026-06-15)"], transcript=transcript)
        self.assertEqual((out, removed), (["Piet: de offerte sturen"], 1))

    def test_model_date_written_in_the_transcript_stays(self):
        for said in ("We leveren het op 15 november 2026 op.", "Deadline is 2026-11-15.", "Voor 15-11-2026 graag.",
                     "Het moet 15 november klaar zijn.", "It is due November 15."):
            with self.subTest(said):
                out, removed = self.run_items(["Anna: lever het op (due 2026-11-15)"], transcript=said)
                self.assertEqual((out, removed), (["Anna: lever het op (due 2026-11-15)"], 0))

    def test_conversation_date_stays_when_the_transcript_names_that_exact_date(self):
        for said in ("Dat moet op 10 juni klaar zijn.", "Voor 10-6 graag.", "Uiterlijk 2026-06-10 aanleveren.",
                     "Done by June 10.", "Het moet 10 juni 2026 af zijn."):
            with self.subTest(said):
                out, removed = self.run_items(["Anna: lever het op (due 2026-06-10)"], transcript=said)
                self.assertEqual((out, removed), (["Anna: lever het op (due 2026-06-10)"], 0))

    def test_conversation_date_is_removed_when_only_another_date_is_named(self):
        out, removed = self.run_items(["Anna: lever het op (due 2026-06-10)"], transcript="Het moet 11 juni af zijn.")
        self.assertEqual((out, removed), (["Anna: lever het op"], 1))

    def test_model_date_with_another_month_day_in_the_transcript_is_removed(self):
        out, removed = self.run_items(["Anna: lever het op (due 2026-11-15)"], transcript="We leveren het op 16 november op.")
        self.assertEqual((out, removed), (["Anna: lever het op"], 1))

    def test_calendar_words_and_relative_words_convert(self):
        items = [
            "A: een (due 15 november)", "B: twee (due volgende week dinsdag)", "C: drie (due eind van de maand)",
            "D: vier (due morgen)", "E: vijf (due na de vergadering)",
        ]
        out, removed = self.run_items(items, transcript="Alles voor 15 november, dinsdag, morgen, eind van de maand.")
        self.assertEqual(out[:4], [
            "A: een (due 2026-11-15)", "B: twee (due 2026-06-16)", "C: drie (due 2026-06-30)", "D: vier (due 2026-06-11)",
        ])
        # Unknown form: kept as text, never a date.
        self.assertEqual(out[4], "E: vijf na de vergadering")
        self.assertEqual(removed, 0)

    def test_vague_deadline_becomes_task_text(self):
        out, _ = self.run_items(["Piet: de demo-omgeving nakijken (due na de release)"])
        self.assertEqual(out, ["Piet: de demo-omgeving nakijken na de release"])
        out, _ = self.run_items(["de demo nakijken (due soon)"])
        self.assertEqual(out, ["de demo nakijken soon"])

    def test_vague_text_is_not_repeated_when_the_task_already_has_it(self):
        out, _ = self.run_items(["Piet: nakijken na de release (due na de release)"])
        self.assertEqual(out, ["Piet: nakijken na de release"])

    def test_placeholders_vanish_without_text(self):
        out, _ = self.run_items(["Piet: nakijken (due unknown)", "Piet: sturen (due TBD)", "Piet: bellen (due)"])
        self.assertEqual(out, ["Piet: nakijken", "Piet: sturen", "Piet: bellen"])

    def test_spoken_form_needs_deadline_language_in_the_transcript_to_become_a_date(self):
        out, removed = self.run_items(["Piet: nakijken (due vrijdag)"], transcript="We bespraken de planning.")
        self.assertNotIn("2026", out[0])

    def test_without_conversation_date_words_stay_as_text_and_absolute_dates_convert(self):
        out, removed = strip_unsupported_due_dates(
            ["Piet: nakijken (due vrijdag)", "Anna: sturen (due 15 november 2026)", "Jan: bellen (due 15 november)"],
            "Vrijdag, 15 november 2026 en 15 november.", None)
        self.assertEqual(out, ["Piet: nakijken vrijdag", "Anna: sturen (due 2026-11-15)", "Jan: bellen 15 november"])

    def test_item_without_due_is_untouched(self):
        out, removed = self.run_items(["Gewoon een taak", "Anna: iets"])
        self.assertEqual((out, removed), (["Gewoon een taak", "Anna: iets"], 0))

    def test_english_words(self):
        out, _ = self.run_items(["Piet: check it (due Friday)", "Anna: send it (due tomorrow)"],
                                transcript="I will do it Friday. Tomorrow I send it.")
        self.assertEqual(out, ["Piet: check it (due 2026-06-12)", "Anna: send it (due 2026-06-11)"])


class OwnerTests(unittest.TestCase):
    def test_owner_not_in_the_transcript_is_dropped_and_task_stays(self):
        out, removed = drop_unsupported_owners(["Marieke: de offerte sturen (due 2026-06-12)"], TRANSCRIPT)
        self.assertEqual((out, removed), (["de offerte sturen (due 2026-06-12)"], 1))

    def test_speaker_or_mentioned_name_stays(self):
        items = ["Piet: nakijken", "Anna: bellen", "speaker 2: bellen"]
        out, removed = drop_unsupported_owners(items, TRANSCRIPT)
        self.assertEqual((out, removed), (items, 0))

    def test_mentioned_only_name_stays(self):
        out, removed = drop_unsupported_owners(["Jan: bellen"], "[Anna] Jan, kun jij de klant bellen?")
        self.assertEqual((out, removed), (["Jan: bellen"], 0))

    def test_unknown_speaker_label_is_dropped(self):
        out, removed = drop_unsupported_owners(["Speaker 7: bellen"], TRANSCRIPT)
        self.assertEqual((out, removed), (["bellen"], 1))

    def test_name_inside_another_word_does_not_count(self):
        out, removed = drop_unsupported_owners(["Pie: bellen"], TRANSCRIPT)
        self.assertEqual(out, ["bellen"])

    def test_task_prefix_that_is_not_a_name_stays(self):
        items = ["Voorbereiden demo: slides maken", "let op: de klant belt"]
        out, removed = drop_unsupported_owners(items, TRANSCRIPT)
        self.assertEqual((out[0], out[1]), (items[0], items[1]))

    def test_multi_word_name_needs_given_name_or_surname(self):
        # The given name or the surname in the transcript is enough; neither of them is not.
        out, removed = drop_unsupported_owners(["Piet de Vries: bellen"], TRANSCRIPT)
        self.assertEqual(removed, 0)
        out, removed = drop_unsupported_owners(["Marieke de Vries: bellen"], TRANSCRIPT)
        self.assertEqual(out, ["bellen"])
        out, removed = drop_unsupported_owners(["Marieke de Vries: bellen"], TRANSCRIPT + "\n[Anna] Vries komt later.")
        self.assertEqual(removed, 0)

    def test_without_a_transcript_nothing_changes(self):
        out, removed = drop_unsupported_owners(["Marieke: bellen"], None)
        self.assertEqual((out, removed), (["Marieke: bellen"], 0))


class MeasuredOutputEndToEndTests(unittest.TestCase):
    """Raw model output as measured on gemma4:e2b-nvfp4, through the real post-processing and parser."""

    def parsed(self, bullets):
        md = "## Summary\nKort.\n\n## Action Items\n" + bullets + "\n"
        out = _action_items_as_tasks(md, transcript=TRANSCRIPT, meeting_date="2026-06-10")
        return MeetingPipeline._parse_streamed_markdown(out)["action_items"]

    def test_wrong_weekday_date_from_the_model_never_survives(self):
        items = self.parsed("- Piet: de demo-omgeving nakijken (due 2026-06-11)\n- Speaker 2: de leverancier bellen")
        self.assertFalse(any("2026-06-11" in i for i in items))
        self.assertTrue(items[0].startswith("Piet: de demo-omgeving nakijken"))

    def test_spoken_weekday_gives_piet_and_the_right_date(self):
        items = self.parsed(
            "- Piet: de demo-omgeving nakijken (due vrijdag)\n"
            "- de klantvragenlijst bijwerken\n"
            "- Speaker 2: de leverancier bellen")
        self.assertEqual(items, [
            "Piet: de demo-omgeving nakijken (due 2026-06-12)",
            "de klantvragenlijst bijwerken",
            "Speaker 2: de leverancier bellen",
        ])

    def test_invented_owner_is_dropped_and_vague_deadline_kept_as_text(self):
        items = self.parsed("- Marieke: de klantvragenlijst bijwerken (due na de release)")
        self.assertEqual(items, ["de klantvragenlijst bijwerken na de release"])

    def test_owner_check_also_works_for_bold_owner(self):
        items = self.parsed("- **Marieke:** de klantvragenlijst bijwerken")
        self.assertEqual(items, ["de klantvragenlijst bijwerken"])

    def test_split_item_with_spoken_deadline_on_the_head(self):
        items = self.parsed("- **Piet** (due vrijdag)\n  De demo-omgeving nakijken")
        self.assertEqual(items, ["Piet: De demo-omgeving nakijken (due 2026-06-12)"])

    def test_without_a_transcript_the_text_stays_as_written(self):
        out = _action_items_as_tasks("## Action Items\n- Marieke: bel (due 2026-06-11)\n")
        self.assertIn("- [ ] Marieke: bel (due 2026-06-11)", out)


class PromptTests(unittest.TestCase):
    def rules(self, meeting_date):
        from src.summarizer import _action_item_rules
        return _action_item_rules(meeting_date)

    def test_prompt_asks_for_the_deadline_as_spoken_and_forbids_computing(self):
        for rules in (self.rules("2026-06-10"), self.rules(None)):
            self.assertIn("(due <deadline exactly as spoken>)", rules)
            self.assertIn("Do not calculate", rules)
            self.assertNotIn("Resolve a relative deadline", rules)
            self.assertNotIn("(due YYYY-MM-DD)", rules)
            self.assertIn("(due friday)", rules.lower())
            self.assertIn("(due next week tuesday)", rules.lower())
            self.assertIn("(due 15 november)", rules.lower())
            self.assertIn("(due end of the month)", rules.lower())

    def test_prompt_keeps_open_tasks_nobody_took_on(self):
        # Measured on gemma4:e2b-nvfp4: without this rule and example the model dropped
        # 'the questionnaire still has to be updated, nobody owns it' in 8 of 8 runs.
        rules = self.rules("2026-06-10")
        self.assertIn("also when nobody took it on", rules)
        self.assertIn('"- update the questionnaire"', rules)

    def test_prompt_examples_cover_every_outcome(self):
        rules = self.rules("2026-06-10")
        self.assertIn("-> \"- Emma: send the offer to the client (due friday)\"", rules)
        self.assertIn("-> \"- Jan: book the room\"", rules)
        self.assertIn("-> \"- update the planning\"", rules)
        self.assertIn("-> \"- Speaker 2: call the supplier\"", rules)
        self.assertIn("-> \"- update the planning (due 15 november)\"", rules)
        self.assertIn("never put the task on a second line", rules)
        self.assertIn("never write only a name and a date", rules)

    def test_prompt_never_shows_the_real_conversation_date(self):
        self.assertNotIn("2026-06-10", self.rules("2026-06-10"))


if __name__ == "__main__":
    unittest.main()
