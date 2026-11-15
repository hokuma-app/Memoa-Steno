"""Synthetic per-run regeneration, with only the provider boundary replaced."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from click.testing import CliRunner

class SummaryRegenerationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.env = mock.patch.dict(os.environ, {'STENOAI_USER_DATA_DIR': self.temp.name, 'HF_HUB_OFFLINE': '1'})
        self.env.start(); self.addCleanup(self.env.stop)
        from src.config import Config
        self.config = Config(config_path=Path(self.temp.name) / 'config.json')
        self.config_patch = mock.patch('src.config.get_config', return_value=self.config)
        self.config_patch.start(); self.addCleanup(self.config_patch.stop)
        from src.summarizer import OllamaSummarizer
        self.s = object.__new__(OllamaSummarizer)
        self.s.model_name = 'synthetic-model'
        self.s.ai_provider = 'remote'
        self.s.ollama_process = None
        self.s._summary_config = self.config
        self.prompts = []
        def stream(prompt):
            self.prompts.append(prompt)
            yield '## Summary\nNieuwe synthetische samenvatting.\n'
        self.provider = mock.patch.object(self.s, '_stream_completion', side_effect=stream)
        self.provider.start(); self.addCleanup(self.provider.stop)
        self.factory = mock.patch('src.summarizer.OllamaSummarizer', return_value=self.s)
        self.factory.start(); self.addCleanup(self.factory.stop)
    def test_run_override_uses_saved_transcript_without_audio_and_preserves_source_sections(self):
        import simple_recorder
        from src import report_store
        note = Path(self.temp.name) / 'synthetic_summary.md'
        tail = '## Transcript\n\n  Synthetische tekst met witruimte.  \n\n## User Notes\n\n  Eigen notitie.  \n\n'
        note.write_text('---\ntitle: Eigen titel\nlanguage: en\nduration_seconds: 60\n---\n\n## Summary\nOude versie.\n\n' + tail)
        canonical = Path(self.temp.name) / 'transcripts' / 'synthetic.txt'
        canonical.parent.mkdir(); canonical.write_bytes(b'UNCHANGED SYNTHETIC CANONICAL\r\n')
        result = CliRunner().invoke(simple_recorder.cli, ['reprocess', str(note), '--summary-detail', 'brief'])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn('SUMMARY DETAIL: brief', self.prompts[0])
        self.assertEqual(self.config.get_summary_detail(), 'detailed')
        self.assertEqual(canonical.read_bytes(), b'UNCHANGED SYNTHETIC CANONICAL\r\n')
        self.assertTrue(note.read_text().endswith(tail))
        self.assertIn('Oude versie.', report_store.load_sidecar(note)['reports'][0]['content'])
    def test_real_http_provider_boundary_preserves_sources_after_partial_stream_failure(self):
        import threading
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        import ollama
        import simple_recorder
        from src import report_store
        self.provider.stop()
        captured = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_POST(self):
                captured.append((self.path, json.loads(self.rfile.read(int(self.headers['Content-Length'])))))
                self.send_response(200)
                self.send_header('Content-Type', 'application/x-ndjson')
                self.end_headers()
                self.wfile.write(json.dumps({'model': 'synthetic-model', 'message': {'role': 'assistant', 'content': '## Summary\nPartial synthetic result'}, 'done': False}).encode() + b'\n')
                self.wfile.write(b'not-valid-json\n')
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close(), thread.join()))
        self.s.client = ollama.Client(host='http://127.0.0.1:' + str(server.server_port))
        note = Path(self.temp.name) / 'synthetic_summary.json'
        note.write_text(json.dumps({'summary': 'Old synthetic version', 'transcript': 'SYNTHETIC HTTP TRANSCRIPT', 'user_notes': 'UNCHANGED OWN NOTES', 'session_info': {'name': 'Eigen titel', 'duration_seconds': 60}}))
        before = note.read_bytes()
        report_store.save_sidecar(note, {'reports': [], 'active_report': None})
        sidecar = report_store.sidecar_path(note).read_bytes()
        ok, error, template = self.config.save_template({'name': 'Eigen sjabloon', 'prompt': 'CUSTOM HTTP TEMPLATE'})
        self.assertTrue(ok, error)
        for command, detail in [(['reprocess', str(note)], 'brief'), (['generate-report', str(note), template['id']], 'balanced')]:
            result = CliRunner().invoke(simple_recorder.cli, command + ['--summary-detail', detail])
            self.assertNotEqual(result.exit_code, 0, result.output)
            self.assertIn('STREAM_ERROR:', result.output)
            self.assertEqual(note.read_bytes(), before)
            self.assertEqual(report_store.sidecar_path(note).read_bytes(), sidecar)
            self.assertEqual(captured[-1][0], '/api/chat')
            prompt = captured[-1][1]['messages'][0]['content']
            self.assertIn('SUMMARY DETAIL: ' + detail, prompt)
            self.assertIn('SYNTHETIC HTTP TRANSCRIPT', prompt)
        self.assertEqual(self.config.get_summary_detail(), 'detailed')

    def test_source_edit_during_generation_is_not_overwritten(self):
        import simple_recorder
        note = Path(self.temp.name) / 'synthetic_summary.json'
        original = {'summary': 'Oude versie', 'transcript': 'Synthetisch transcript', 'user_notes': 'Oude notitie', 'session_info': {'name': 'Eigen titel'}}
        note.write_text(json.dumps(original))
        latest = {**original, 'user_notes': 'Nieuwere eigen notitie'}
        latest_bytes = json.dumps(latest).encode()
        def edited_stream(prompt):
            note.write_bytes(latest_bytes)
            yield '## Summary\nNieuwe samenvatting'
        self.s._stream_completion.side_effect = edited_stream
        result = CliRunner().invoke(simple_recorder.cli, ['reprocess', str(note), '--summary-detail', 'brief'])
        self.assertNotEqual(result.exit_code, 0, result.output)
        self.assertEqual(note.read_bytes(), latest_bytes)

    def test_raw_source_sections_keep_crlf_bytes_on_windows_text_writers(self):
        import simple_recorder
        note = Path(self.temp.name) / 'synthetic_summary.md'
        tail = b'## Transcript\r\n\r\n  Synthetische tekst.  \r\n\r\n## User Notes\r\n\r\n  Eigen notitie.  \r\n'
        note.write_bytes(b'---\ntitle: Eigen titel\nlanguage: en\n---\n\n## Summary\nOud.\n\n' + tail)
        real_temporary_file = tempfile.NamedTemporaryFile
        def windows_writer(*args, **kwargs):
            if kwargs.get('mode') == 'w' and kwargs.get('newline') is None:
                kwargs['newline'] = '\r\n'
            return real_temporary_file(*args, **kwargs)
        with mock.patch('src.config.tempfile.NamedTemporaryFile', side_effect=windows_writer):
            result = CliRunner().invoke(simple_recorder.cli, ['reprocess', str(note), '--summary-detail', 'brief'])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertTrue(note.read_bytes().endswith(tail), 'CRLF transcript and notes must not be translated again')

    def test_invalid_override_never_calls_provider_or_changes_source(self):
        import simple_recorder
        note = Path(self.temp.name) / 'synthetic_summary.json'
        note.write_text(json.dumps({'transcript': 'synthetic', 'session_info': {'name': 'Eigen titel'}}))
        before = note.read_bytes()
        result = CliRunner().invoke(simple_recorder.cli, ['reprocess', str(note), '--summary-detail', 'invalid'])
        self.assertNotEqual(result.exit_code, 0)
        self.assertEqual(self.prompts, [])
        self.assertEqual(note.read_bytes(), before)
    def test_custom_report_override_retains_old_report_and_canonical_bytes(self):
        import simple_recorder
        from src import report_store, reports
        ok, error, template = self.config.save_template({'name': 'Eigen sjabloon', 'prompt': 'SYNTHETIC CUSTOM TEMPLATE'})
        self.assertTrue(ok, error)
        note = Path(self.temp.name) / 'synthetic_summary.json'
        note.write_text(json.dumps({'summary': 'Oude samenvatting', 'transcript': 'Synthetisch transcript', 'user_notes': 'Eigen notities', 'session_info': {'name': 'Eigen titel', 'duration_seconds': 60}}))
        old = reports.make_report(template['id'], 'Eigen sjabloon', 'synthetic', 'Oud rapport')
        report_store.save_sidecar(note, {'reports': [old], 'active_report': old['id']})
        before = note.read_bytes()
        result = CliRunner().invoke(simple_recorder.cli, ['generate-report', str(note), template['id'], '--summary-detail', 'balanced'])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn('SUMMARY DETAIL: balanced', self.prompts[0])
        self.assertIn('SYNTHETIC CUSTOM TEMPLATE', self.prompts[0])
        self.assertEqual(note.read_bytes(), before)
        self.assertEqual(len(report_store.load_sidecar(note)['reports']), 2)
        self.assertEqual(report_store.load_sidecar(note)['reports'][0], old)
        self.assertEqual(self.config.get_summary_detail(), 'detailed')
