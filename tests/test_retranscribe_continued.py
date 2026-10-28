"""Re-transcribe of a continued note (continue-recording).

A continued note spans several recordings, but its filename stem matches only
the first. Re-transcribe used to find just that one and replace the whole
transcript with it, silently dropping every continued segment. The append path
now records each segment's recording stem in `continued_recordings`, and
re-transcribe runs every segment and rejoins them.
"""
import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from click.testing import CliRunner

import simple_recorder

_MD = """\
---
title: "Sync"
duration_seconds: 600
language: "en"
configured_language: "en"
detected_language: "en"
is_diarised: false
folders: []
---

## Summary

Old summary

## Transcript

first part
"""


def _fake_transcribe(texts):
    async def fake(self, audio_file, session_name="Recording", *, persist_transcript=True):
        return {
            "transcript_text": texts[Path(audio_file).stem],
            "is_diarised": False,
            "configured_language": "en",
            "detected_language": "en",
            "output_language": "en",
        }
    return fake


class AppendRecordsRecordingTests(unittest.TestCase):
    def test_canonical_preflight_failure_leaves_append_note_unchanged(self):
        for suffix in ('.md', '.json'):
            for invalid in (b'no standard header', b'\xff', None):
                with self.subTest(suffix=suffix, invalid=invalid), tempfile.TemporaryDirectory() as tmp, \
                        mock.patch.dict(os.environ, {'STENOAI_USER_DATA_DIR': tmp}):
                    note = Path(tmp) / f'first_summary{suffix}'
                    note.write_text(_MD if suffix == '.md' else json.dumps({'transcript': 'old first'}))
                    from src.config import get_data_dirs
                    canonical = get_data_dirs()['transcripts'] / 'first_transcript.txt'
                    if invalid is None:
                        canonical.mkdir()
                    else:
                        canonical.write_bytes(invalid)
                    before = note.read_bytes()
                    with self.assertRaises((ValueError, OSError)):
                        simple_recorder._append_segment_to_note(note, 'second', 60, recording_stem='second')
                    self.assertEqual(note.read_bytes(), before)
                    if invalid is not None:
                        self.assertEqual(canonical.read_bytes(), invalid)

    def test_md_append_lists_each_continued_recording(self):
        with tempfile.TemporaryDirectory() as tmp:
            note = Path(tmp) / "first_summary.md"
            note.write_text(_MD)
            simple_recorder._append_segment_to_note(note, "second part", 60, recording_stem="second")
            simple_recorder._append_segment_to_note(note, "third part", 60, recording_stem="third")

            meeting = simple_recorder._parse_meeting_markdown(note)
            self.assertEqual(meeting["continued_recordings"], ["second", "third"])
            self.assertIn("second part", meeting["transcript"])
            self.assertTrue(meeting["session_info"]["notes_stale"])

    def test_append_refreshes_canonical_text_without_losing_speaker_edits(self):
        with tempfile.TemporaryDirectory() as tmp:
            note = Path(tmp) / 'first_summary.md'
            note.write_text(_MD)
            canonical = Path(tmp) / 'first_transcript.txt'
            canonical.write_text('Session: Sync\n\n' + '=' * 60 + '\n\nAlex: corrected first part\n')
            with mock.patch('src.config.get_data_dirs', return_value={'transcripts': Path(tmp)}):
                simple_recorder._append_segment_to_note(note, 'second part', 60, recording_stem='second')
            self.assertIn('Alex: corrected first part', canonical.read_text())
            self.assertIn('second part', canonical.read_text())
            self.assertEqual(canonical.read_text().count('--- Resumed'), 1)

    def test_json_append_lists_continued_recording(self):
        with tempfile.TemporaryDirectory() as tmp:
            note = Path(tmp) / "first_summary.json"
            note.write_text(json.dumps({"transcript": "first part", "session_info": {}}))
            simple_recorder._append_segment_to_note(note, "second part", 60, recording_stem="second")
            self.assertEqual(json.loads(note.read_text())["continued_recordings"], ["second"])


class RetranscribeContinuedNoteTests(unittest.TestCase):
    def test_canonical_preflight_failure_leaves_reprocess_note_unchanged(self):
        for suffix in ('.md', '.json'):
            for invalid in (b'no standard header', b'\xff', None):
                with self.subTest(suffix=suffix, invalid=invalid), tempfile.TemporaryDirectory() as tmp, \
                        mock.patch.dict(os.environ, {'STENOAI_USER_DATA_DIR': tmp}):
                    note = self._setup(tmp, ['first.webm'], suffix=suffix)
                    from src.config import get_data_dirs
                    canonical = get_data_dirs()['transcripts'] / 'first_transcript.txt'
                    if invalid is None:
                        canonical.mkdir()
                    else:
                        canonical.write_bytes(invalid)
                    before = note.read_bytes()
                    result = self._invoke(note, {'first': 'fresh first'})
                    self.assertNotEqual(result.exit_code, 0, result.output)
                    self.assertEqual(note.read_bytes(), before)
                    self.assertFalse(note.with_name('first_reports.json').exists())
                    if invalid is not None:
                        self.assertEqual(canonical.read_bytes(), invalid)

    def test_real_transcriber_failures_preserve_all_published_files(self):
        for failure in ('second-segment', 'summary'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as tmp, \
                    mock.patch.dict(os.environ, {'STENOAI_USER_DATA_DIR': tmp}):
                note = self._setup(tmp, ['first.webm', 'second.webm'])
                simple_recorder._append_segment_to_note(note, 'old second', 60, recording_stem='second')
                from src.config import get_data_dirs
                dirs = get_data_dirs()
                canonical = dirs['transcripts'] / 'first_transcript.txt'
                canonical.write_text('Session: Sync\n\n' + '=' * 60 + '\n\nold first and second\n')
                continued_txt = dirs['transcripts'] / 'second_transcript.txt'
                continued_txt.write_text('existing continued transcript')
                speaker = dirs['output'] / 'first_speakers.json'
                speaker.write_text('{"existing": true}')
                reports = note.with_name('first_reports.json')
                reports.write_text('{"existing": true}')
                published = [note, canonical, continued_txt, speaker, reports]
                before = {p: p.read_bytes() for p in published}
                results: list[dict] = [{'text': 'fresh first', 'detected_language': 'en'},
                           {'text': 'fresh second', 'detected_language': 'en'}]
                if failure == 'second-segment':
                    results[1] = {'transcription_failed': True, 'error': 'synthetic ASR failure'}
                summarizer = mock.Mock(model_name='test-model')
                summarizer.summarize_transcript_streaming.side_effect = RuntimeError('synthetic summary failure')
                with mock.patch.object(simple_recorder.WhisperTranscriber, 'transcribe_diarised', side_effect=results) as asr, \
                        mock.patch('src.summarizer.OllamaSummarizer', return_value=summarizer):
                    result = CliRunner().invoke(simple_recorder.reprocess, [str(note), '--retranscribe'])
                self.assertNotEqual(result.exit_code, 0, result.output)
                self.assertEqual(asr.call_count, 2, result.output)
                self.assertIn('STREAM_ERROR:', result.output)
                self.assertEqual({p: p.read_bytes() for p in published}, before)

    def test_real_default_transcribe_still_publishes_canonical(self):
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.dict(os.environ, {'STENOAI_USER_DATA_DIR': tmp}):
            note = self._setup(tmp, ['first.webm'])
            pipeline = simple_recorder.MeetingPipeline()
            with mock.patch.object(simple_recorder.WhisperTranscriber, 'transcribe_diarised',
                                   return_value={'text': 'fresh default', 'detected_language': 'en'}):
                result = asyncio.run(pipeline.transcribe_audio(str(Path(tmp) / 'recordings/first.webm')))
            self.assertIn('fresh default', Path(result['transcript_file']).read_text())

    def test_real_retranscribe_publishes_only_combined_canonical_after_summary(self):
        for existing in (True, False):
            with self.subTest(existing=existing), tempfile.TemporaryDirectory() as tmp, \
                    mock.patch.dict(os.environ, {'STENOAI_USER_DATA_DIR': tmp}):
                note = self._setup(tmp, ['first.webm', 'second.webm'])
                simple_recorder._append_segment_to_note(note, 'old second', 60, recording_stem='second')
                from src.config import get_data_dirs
                dirs = get_data_dirs()
                canonical = dirs['transcripts'] / 'first_transcript.txt'
                header = 'Session: Sync\n\n' + '=' * 60 + '\n\n'
                if existing:
                    canonical.write_text(header + 'old combined')
                before = canonical.read_bytes() if existing else None

                def summary(*args, **kwargs):
                    self.assertEqual(canonical.read_bytes() if canonical.exists() else None, before)
                    yield '## Summary\n\nNew summary\n'

                summarizer = mock.Mock(model_name='test-model')
                summarizer.summarize_transcript_streaming.side_effect = summary
                with mock.patch.object(simple_recorder.WhisperTranscriber, 'transcribe_diarised',
                                       side_effect=[{'text': 'fresh first'}, {'text': 'fresh second'}]), \
                        mock.patch('src.summarizer.OllamaSummarizer', return_value=summarizer):
                    result = CliRunner().invoke(simple_recorder.reprocess, [str(note), '--retranscribe'])
                self.assertEqual(result.exit_code, 0, result.output)
                self.assertTrue(canonical.exists())
                text = canonical.read_text()
                self.assertIn('fresh first', text)
                self.assertIn('fresh second', text)
                self.assertNotIn('old combined', text)
                self.assertFalse((dirs['transcripts'] / 'second_transcript.txt').exists())
                if existing:
                    self.assertTrue(text.startswith(header))

    def _setup(self, tmp, recordings, suffix=".md"):
        rec_dir = Path(tmp) / "recordings"
        rec_dir.mkdir()
        for name in recordings:
            (rec_dir / name).write_bytes(b"audio")
        note = Path(tmp) / f"first_summary{suffix}"
        if suffix == ".md":
            note.write_text(_MD)
        else:
            note.write_text(json.dumps({
                "session_info": {"name": "Sync", "duration_seconds": 600},
                "transcript": "first part",
            }))
        return note

    def _invoke(self, note, texts):
        summarizer = mock.Mock(model_name="test-model")
        summarizer.summarize_transcript_streaming.return_value = iter(["## Summary\n\nNew summary\n"])
        with mock.patch.object(simple_recorder.MeetingPipeline, "transcribe_audio", _fake_transcribe(texts)), \
             mock.patch("src.summarizer.OllamaSummarizer", return_value=summarizer), \
             mock.patch.object(simple_recorder, "_persist_speaker_sidecar"):
            return CliRunner().invoke(simple_recorder.reprocess, [str(note), "--retranscribe"])

    def test_every_segment_is_retranscribed_and_rejoined(self):
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.dict(os.environ, {"STENOAI_USER_DATA_DIR": tmp}):
            note = self._setup(tmp, ["first.webm", "second.webm"])
            simple_recorder._append_segment_to_note(note, "old second", 60, recording_stem="second")
            separator = next(
                ln for ln in note.read_text().splitlines() if ln.startswith("--- Resumed")
            )

            res = self._invoke(note, {"first": "new first", "second": "new second"})

            self.assertEqual(res.exit_code, 0, res.output)
            meeting = simple_recorder._parse_meeting_markdown(note)
            self.assertEqual(
                meeting["transcript"], f"new first\n\n{separator}\n\nnew second"
            )
            # A later re-transcribe must still find the continued segment.
            self.assertEqual(meeting["continued_recordings"], ["second"])

    def test_retranscribe_refreshes_existing_canonical_transcript(self):
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.dict(os.environ, {'STENOAI_USER_DATA_DIR': tmp}):
            note = self._setup(tmp, ['first.webm', 'second.webm'])
            transcripts = Path(tmp) / 'transcripts'
            transcripts.mkdir()
            canonical = transcripts / 'first_transcript.txt'
            header = 'Session: Sync\n\n' + '=' * 60 + '\n\n'
            canonical.write_text(header + 'old first\n')
            simple_recorder._append_segment_to_note(note, 'old second', 60, recording_stem='second')
            result = self._invoke(note, {'first': 'new first', 'second': 'new second'})
            self.assertEqual(result.exit_code, 0, result.output)
            self.assertTrue(canonical.read_text().startswith(header))
            self.assertIn('new first', canonical.read_text())
            self.assertIn('new second', canonical.read_text())
            self.assertNotIn('old first', canonical.read_text())

    def test_invalid_continuation_identity_is_refused_without_changes(self):
        for stems in [['second', 'second'], ['../second'], ['first'], [42], 'second', False, 0, '', None]:
            with self.subTest(stems=stems), tempfile.TemporaryDirectory() as tmp, \
                    mock.patch.dict(os.environ, {'STENOAI_USER_DATA_DIR': tmp}):
                note = self._setup(tmp, ['first.webm', 'second.webm'], suffix='.json')
                data = json.loads(note.read_text())
                data['continued_recordings'] = stems
                note.write_text(json.dumps(data))
                before = note.read_bytes()
                result = self._invoke(note, {'first': 'new first', 'second': 'new second'})
                self.assertNotEqual(result.exit_code, 0, result.output)
                self.assertIn('STREAM_ERROR:RETRANSCRIBE_UNLINKED_SEGMENTS', result.output)
                self.assertEqual(note.read_bytes(), before)

    def test_invalid_markdown_continuation_metadata_is_not_treated_as_absent(self):
        for raw in ('[BROKEN', 'false', '0', '""', 'null'):
            with self.subTest(raw=raw), tempfile.TemporaryDirectory() as tmp, \
                    mock.patch.dict(os.environ, {'STENOAI_USER_DATA_DIR': tmp}):
                note = self._setup(tmp, ['first.webm'])
                note.write_text(_MD.replace('folders: []', f'folders: []\ncontinued_recordings: {raw}'))
                before = note.read_bytes()
                value = simple_recorder._parse_meeting_markdown(note)['continued_recordings']
                self.assertNotIsInstance(value, list)
                result = self._invoke(note, {'first': 'fresh first'})
                self.assertNotEqual(result.exit_code, 0, result.output)
                self.assertIn('STREAM_ERROR:RETRANSCRIBE_UNLINKED_SEGMENTS', result.output)
                self.assertEqual(note.read_bytes(), before)

    def test_failed_continuation_does_not_change_original_note_or_canonical(self):
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.dict(os.environ, {'STENOAI_USER_DATA_DIR': tmp}):
            note = self._setup(tmp, ['first.webm', 'second.webm'])
            simple_recorder._append_segment_to_note(note, 'old second', 60, recording_stem='second')
            transcripts = Path(tmp) / 'transcripts'
            transcripts.mkdir(exist_ok=True)
            canonical = transcripts / 'first_transcript.txt'
            original_canonical = 'Session: Sync\n\n' + '=' * 60 + '\n\nOriginal canonical transcript'
            canonical.write_text(original_canonical)
            before = note.read_bytes()
            calls = []

            async def transcribe(_self, audio_file, _name, *, persist_transcript=True):
                calls.append(Path(audio_file).stem)
                if len(calls) == 2:
                    return {'transcription_failed': True, 'error': 'synthetic continuation failure'}
                return {'transcript_text': 'fresh first'}

            with mock.patch.object(simple_recorder.MeetingPipeline, 'transcribe_audio', transcribe):
                result = CliRunner().invoke(simple_recorder.reprocess, [str(note), '--retranscribe'])
            self.assertNotEqual(result.exit_code, 0, result.output)
            self.assertEqual(calls, ['first', 'second'])
            self.assertEqual(note.read_bytes(), before)
            self.assertEqual(canonical.read_text(), original_canonical)

    def test_json_note_is_retranscribed_and_keeps_its_list(self):
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.dict(os.environ, {"STENOAI_USER_DATA_DIR": tmp}):
            note = self._setup(tmp, ["first.webm", "second.webm"], suffix=".json")
            simple_recorder._append_segment_to_note(note, "old second", 60, recording_stem="second")
            separator = json.loads(note.read_text())["transcript"].split("\n\n")[1]

            res = self._invoke(note, {"first": "new first", "second": "new second"})

            self.assertEqual(res.exit_code, 0, res.output)
            data = json.loads(note.read_text())
            self.assertEqual(data["transcript"], f"new first\n\n{separator}\n\nnew second")
            self.assertEqual(data["continued_recordings"], ["second"])

    def test_a_part_that_now_comes_back_silent_keeps_its_place(self):
        # Dropping it would delete a part of the meeting the note already had.
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.dict(os.environ, {"STENOAI_USER_DATA_DIR": tmp}):
            note = self._setup(tmp, ["first.webm", "second.webm"])
            simple_recorder._append_segment_to_note(note, "old second", 60, recording_stem="second")
            separator = next(
                ln for ln in note.read_text().splitlines() if ln.startswith("--- Resumed")
            )

            res = self._invoke(note, {"first": "new first", "second": ""})

            self.assertEqual(res.exit_code, 0, res.output)
            self.assertEqual(
                simple_recorder._parse_meeting_markdown(note)["transcript"],
                f"new first\n\n{separator}\n\n{simple_recorder._SILENCE_SENTINEL}",
            )

    def test_note_continued_before_the_list_existed_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.dict(os.environ, {"STENOAI_USER_DATA_DIR": tmp}):
            note = self._setup(tmp, ["first.webm", "second.webm"])
            simple_recorder._append_segment_to_note(note, "old second", 60)
            before = note.read_text()

            res = self._invoke(note, {"first": "new first", "second": "new second"})

            self.assertNotEqual(res.exit_code, 0, res.output)
            self.assertIn("STREAM_ERROR:RETRANSCRIBE_UNLINKED_SEGMENTS", res.output)
            self.assertEqual(note.read_text(), before)

    def test_missing_continued_recording_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.dict(os.environ, {"STENOAI_USER_DATA_DIR": tmp}):
            note = self._setup(tmp, ["first.webm"])
            simple_recorder._append_segment_to_note(note, "old second", 60, recording_stem="second")
            before = note.read_text()

            res = self._invoke(note, {"first": "new first"})

            self.assertNotEqual(res.exit_code, 0, res.output)
            self.assertIn("STREAM_ERROR:RETRANSCRIBE_NO_AUDIO", res.output)
            self.assertEqual(note.read_text(), before)


if __name__ == "__main__":
    unittest.main()