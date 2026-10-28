"""Regression coverage for source selection and destination ownership."""
import unittest

from tests import test_obsidian_sync as fixtures
from custom import obsidian_sync as sync


class TranscriptCoherenceTests(fixtures.ObsidianSyncTests):
    def test_legacy_continuation_never_exports_only_stale_canonical_prefix(self):
        first = '[00:01] [Others] First part.'
        for separator in ('--- Resumed 12:34 ---', '--- Continued recording 12:34 ---'):
            with self.subTest(separator=separator):
                full = first + '\n\n' + separator + '\n\n[00:01] [Others] Second part.'
                self.note(transcript=full, notes_stale=True)
                self.canonical.write_text(first)
                self.assertTrue(self.run_sync())
                exported = self.exported('transcript').read_text()
                self.assertIn('Second part.', exported)
                self.assertIn('transcript_complete: true', exported)

    def test_ambiguous_continuation_holds_both_exports_and_state(self):
        self.note()
        self.run_sync()
        before = {kind: self.exported(kind).read_text() for kind in ('note', 'transcript')}
        entry = dict(self.state[self.stem])
        self.note(transcript='[00:01] [Others] First part.\n\n--- Resumed 12:34 ---\n\nNew part.')
        self.canonical.write_text('[00:01] [Alex] First part.')
        with self.assertRaisesRegex(RuntimeError, 'sources disagree'):
            self.run_sync()
        self.assertEqual(self.state[self.stem], entry)
        for kind, text in before.items():
            self.assertEqual(self.exported(kind).read_text(), text)

    def test_coherent_continued_txt_speaker_edits_remain_authoritative(self):
        full = '[00:01] [Others] First.\n\n--- Resumed 12:34 ---\n\n[00:01] [Others] Second.'
        self.note(transcript=full)
        self.canonical.write_text(full.replace('[Others]', '[Alex]'))
        self.run_sync()
        content = self.exported('transcript').read_text()
        self.assertIn('[Alex] First.', content)
        self.assertIn('[Alex] Second.', content)
        self.assertNotIn('[Others]', content)

    def test_old_source_revision_is_revisited_to_repair_truncated_exports(self):
        import json
        self.note()
        self.run_sync()
        self.note(transcript='[00:01] [Others] All words retained.\n\n--- Resumed 12:34 ---\n\nSecond part.')
        self.canonical.write_text('[00:01] [Others] All words retained.')
        raw = self.source.read_text()
        self.state[self.stem]['source_hash'] = sync.sha(json.dumps([
            'managed-v3-speakers', raw, '', sync.canonical_transcript(self.cfg, self.stem), '', sync.speaker_revision()]))
        self.assertTrue(self.run_sync())
        self.assertIn('Second part.', self.exported('transcript').read_text())


class DestinationOwnershipTests(fixtures.ObsidianSyncTests):
    def test_native_note_identity_allows_only_absent_or_matching_type(self):
        header = '---\nsource: Steno\nsteno_stem: %s\n' % self.stem
        for declaration in ('', 'type: note\n', 'type: "note"\n'):
            with self.subTest(accepted=declaration):
                self.assertTrue(sync.document_identity_matches(header + declaration + '---\n', self.stem, 'note'))
        for value in ('transcript', 'null', 'false', '[]', '{}', '123', '', 'Note', '[note]', 'note\n  malformed'):
            with self.subTest(rejected=value):
                self.assertFalse(sync.document_identity_matches(
                    header + 'type: ' + value + '\n---\n', self.stem, 'note'))
        for kind in ('note', 'transcript'):
            for value in (None, 'note', 'transcript', 'null', '[]'):
                with self.subTest(generated_kind=kind, value=value):
                    declaration = '' if value is None else 'type: ' + value + '\n'
                    generated = header + 'steno_id: %s\n' % self.stem + declaration + '---\n'
                    self.assertEqual(sync.document_identity_matches(generated, self.stem, kind), value == kind)

    def test_replaced_counterpart_holds_entire_pair_with_or_without_force(self):
        import copy
        for kind in ('note', 'transcript'):
            for force in (False, True):
                with self.subTest(kind=kind, force=force):
                    self.vault = self.root / ('vault-%s-%s' % (kind, force))
                    self.vault.mkdir()
                    self.cfg['vault'] = str(self.vault)
                    self.state = {}
                    self.note()
                    self.run_sync()
                    self.exported(kind).write_text(
                        '---\nsteno_id: foreign\ntype: %s\n---\nForeign content.\n' % kind)
                    self.assertNotIn((self.stem, kind), sync.index_locations(self.cfg, self.state))
                    self.note(notes='Changed notes must not be partially exported.')
                    before_state = copy.deepcopy(self.state)
                    before_files = {p: p.read_bytes() for p in self.vault.rglob('*') if p.is_file()}
                    with self.assertRaisesRegex(RuntimeError, 'identity'):
                        sync.sync_one(self.cfg, self.state, str(self.source), False, force)
                    self.assertEqual(self.state, before_state)
                    self.assertEqual({p: p.read_bytes() for p in self.vault.rglob('*') if p.is_file()}, before_files)

    def test_state_only_counterpart_path_is_checked_when_recreation_is_suppressed(self):
        import copy
        for kind in ('note', 'transcript'):
            with self.subTest(kind=kind):
                self.vault = self.root / ('vault-' + kind)
                self.vault.mkdir()
                self.cfg['vault'] = str(self.vault)
                self.state = {}
                self.note()
                self.run_sync()
                moved = self.vault / ('custom-' + kind + '.md')
                self.exported(kind).rename(moved)
                self.state[self.stem][kind + '_rel'] = moved.name
                moved.write_text('---\nsteno_id: foreign\ntype: %s\n---\nForeign.\n' % kind)
                self.note(notes='Changed source.')
                before_state = copy.deepcopy(self.state)
                before_files = {p: p.read_bytes() for p in self.vault.rglob('*') if p.is_file()}
                with self.assertRaisesRegex(RuntimeError, 'identity'):
                    self.run_sync()
                self.assertEqual(self.state, before_state)
                self.assertEqual({p: p.read_bytes() for p in self.vault.rglob('*') if p.is_file()}, before_files)

    def test_relocated_identity_ignores_foreign_replacement_at_obsolete_filename(self):
        for kind in ('note', 'transcript'):
            for force in (False, True):
                with self.subTest(kind=kind, force=force):
                    self.vault = self.root / ('vault-%s-%s' % (kind, force))
                    self.vault.mkdir()
                    self.cfg['vault'] = str(self.vault)
                    self.state = {}
                    self.note()
                    self.run_sync()
                    old = self.exported(kind)
                    moved = old.with_name('relocated-' + old.name)
                    old.rename(moved)
                    foreign = '---\nsteno_id: foreign\ntype: %s\n---\nForeign.\n' % kind
                    old.write_text(foreign)
                    self.note(notes='Changed source.', transcript='[00:01] [Alex] Updated speech.')
                    self.assertTrue(sync.sync_one(self.cfg, self.state, str(self.source), False, force))
                    self.assertEqual(self.exported(kind), moved)
                    self.assertEqual(old.read_text(), foreign)
                    self.assertIn('Changed source.', self.exported('note').read_text())
                    self.assertIn('Updated speech.', self.exported('transcript').read_text())
                    counterpart = self.exported('transcript' if kind == 'note' else 'note')
                    self.assertIn('[[' + str(moved.relative_to(self.vault)) + ']]', counterpart.read_text())

    def test_deleted_counterpart_stays_missing_unless_force_requested(self):
        for kind in ('note', 'transcript'):
            with self.subTest(kind=kind):
                self.vault = self.root / ('vault-' + kind)
                self.vault.mkdir()
                self.cfg['vault'] = str(self.vault)
                self.state = {}
                self.note()
                self.run_sync()
                removed = self.exported(kind)
                removed.unlink()
                self.note(notes='Changed source.', transcript='[00:01] [Alex] Updated speech.')
                self.assertTrue(self.run_sync())
                self.assertFalse(removed.exists())
                self.assertTrue(sync.sync_one(self.cfg, self.state, str(self.source), False, True))
                self.assertTrue(removed.is_file())

    def test_native_index_cannot_relabel_explicit_transcript_as_note(self):
        import copy
        import json
        self.note()
        legacy = self.vault / 'Legacy.md'
        legacy.write_text('---\nsource: Steno\nsteno_stem: %s\ntype: transcript\n---\nNative transcript.\n' % self.stem)
        index = self.root / 'native-index.json'
        index.write_text(json.dumps({'notes': {self.stem: {'vaultRelPath': legacy.name}}}))
        self.cfg['native_sync_state_path'] = str(index)
        for force in (False, True):
            with self.subTest(force=force):
                before_state = copy.deepcopy(self.state)
                before_files = {p: p.read_bytes() for p in self.vault.rglob('*') if p.is_file()}
                with self.assertRaisesRegex(RuntimeError, 'identity'):
                    sync.sync_one(self.cfg, self.state, str(self.source), False, force)
                self.assertEqual(self.state, before_state)
                self.assertEqual({p: p.read_bytes() for p in self.vault.rglob('*') if p.is_file()}, before_files)

    def test_stale_state_cannot_adopt_replaced_transcript_even_with_force(self):
        self.note()
        self.run_sync()
        note, transcript = self.exported('note'), self.exported('transcript')
        before_note = note.read_text()
        foreign = '---\nsteno_id: foreign\ntype: transcript\n---\nForeign speech.\n'
        transcript.write_text(foreign)
        self.note(notes='Changed notes must not be partially exported.')
        with self.assertRaisesRegex(RuntimeError, 'identity'):
            sync.sync_one(self.cfg, self.state, str(self.source), False, True)
        self.assertEqual(transcript.read_text(), foreign)
        self.assertEqual(note.read_text(), before_note)

    def test_body_identity_text_does_not_allow_adoption(self):
        self.note()
        dt = sync.recording_start(self.stem, {}, str(self.source)).astimezone()
        name = sync.filename_for(self.cfg['note_filename_pattern'], dt, 'Meeting')
        other = self.vault / str(self.cfg['notes_folder']) / name
        other.parent.mkdir(parents=True)
        foreign = 'Human note\nsteno_id: ' + self.stem + '\n'
        other.write_text(foreign)
        self.run_sync()
        self.assertEqual(other.read_text(), foreign)
        self.assertIn('Meeting (2)', self.exported('note').name)

    def test_transcript_only_collision_reserves_both_filenames(self):
        self.note()
        dt = sync.recording_start(self.stem, {}, str(self.source)).astimezone()
        name = sync.filename_for(self.cfg['transcript_filename_pattern'], dt, 'Meeting')
        other = self.vault / str(self.cfg['transcripts_folder']) / name
        other.parent.mkdir(parents=True)
        original = '---\nsteno_id: another-meeting\ntype: transcript\n---\nForeign speech.\n'
        other.write_text(original)
        self.run_sync()
        self.assertEqual(other.read_text(), original)
        self.assertIn('Meeting (2)', self.exported('note').name)
        self.assertIn('Meeting (2)', self.exported('transcript').name)


if __name__ == '__main__':
    unittest.main()
