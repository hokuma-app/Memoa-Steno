# StenoAI → Obsidian

The local sync exports a linked meeting-note/transcript pair. It reads the full
canonical `<stem>_transcript.txt`, with the embedded Markdown transcript as a
legacy fallback. It never exports recordings, voice embeddings or credentials.

For continued meetings, a legacy embedded transcript that exactly extends TXT at a `--- Resumed HH:MM ---` boundary is exported in full (the older `--- Continued recording ... ---` form is also recognized). Complete, coherent TXT speaker edits remain authoritative. If the sources disagree on speech or a stale TXT prefix contains different speaker edits, export is held for source repair before either vault file changes. File modification times alone do not prove completeness. Upgrading the exporter revisits previously tracked sources to repair old truncated exports.

A completed batch transcript is exported even when summary generation is off or
fails. The meeting note includes the available AI summary and My notes; My notes
never appear in the transcript file. Processing placeholders, failed
transcriptions and rescued live-preview-only results are held back.
`summary_available` and `summary_stale` record the state of the available summary.

## Speaker identification and invitees

Acoustic speaker analysis runs during StenoAI transcription. Before writing
**either** vault file, sync runs the installed backend's model-free
`suggest-speakers` command against that saved analysis and the current person
profiles. This is the same ranking used by the Speakers panel; it does not run
another transcription, load acoustic models, send requests, or approve names.
The normal settle delay allows the pipeline's related source writes to finish.
A failed ranking, changed analysis run, or source/profile change during ranking
holds back the update and records an error for retry. A meeting without saved
acoustic analysis is explicitly `unavailable`; opted-out identification is
`disabled`. Neither state is presented as completed identification.

Both files include a **Speaker identification** section with readable tables
and a versioned JSON block under **Structured speaker data**. The JSON contract
is `schema_version: 1` and includes:

- `analysis_status`: `complete`, `unavailable`, or `disabled`.
- `calendar_invitees`: names, emails, calendar-self flag and RSVP status, including
  the calendar owner; `calendar_event` and `calendar_organizer` retain provenance.
  An invitation or accepted RSVP is not proof of attendance or speaking.
- `speakers`: every saved review row, including rows filtered in the app. Each
  record has its channel/cluster reference, merged cluster IDs, transcript labels,
  speech duration, segment count, filtering hints, match candidates/distances,
  and match reasons. References are scoped by `diarization_run_id`; a new analysis
  can reuse cluster numbers for different voices.
- `review_status`: `confirmed` only for a persisted human confirmation;
  `unconfirmed` for a name suggestion; otherwise `unidentified`, `kept_generic`,
  or `mixed`. `confirmed_name` and `suggested_name` remain separate. The backend's
  strong suggestion tier is translated to `suggestion_strength: likely`, never
  to human confirmation. Match distances are cosine distances, not probabilities.
- `transcript_turns`: 1-based positions among timestamped speaker lines, excluding
  headers. These are included only when saved per-turn provenance matches the
  transcript's line count and timestamps (`turn_mapping: exact`). Legacy,
  reanalysed, or continued transcripts whose provenance no longer fits have
  `turn_mapping: unavailable` and empty associations; proximity is never guessed.
  `transcript_sha256` hashes the selected complete transcript body before this context is
  appended. A `You` label can be a microphone default, not verified identity.

Frontmatter offers simple Obsidian properties: `confirmed_speakers`,
`suggested_speakers`, `speaker_identification_schema`, and
`speaker_identification_status`. The existing `attendees` properties remain
calendar-sourced. `participants` comes from the StenoAI summary's Participants
section (`participants_source: steno_summary`), which can contain generated
information; use `confirmed_speakers` for actual human confirmations.

Speaker confirmations update the canonical transcript and Participants section
in StenoAI, then the exports refresh. The summary prose remains as generated;
use Generate notes when a newly speaker-aware summary is wanted. Tentative names
are exported as evidence and never substituted into transcript speaker labels.
Profile edits, review markings, sidecar changes, calendar changes and transcript
edits invalidate exports. Previously tracked meetings are checked even outside
the normal look-back window, including archived files. Unchanged sources skip
ranking and writing. No automatic human approval is introduced.

## Preserving vault edits

Exports use `steno_id` to follow files into configured archive folders, even
when filenames change. Subsequent title changes update metadata while filenames
stay stable, protecting existing links. Removed files are not recreated unless
`--force` is explicitly requested.

Both destination names are checked together for collisions. An existing target is adopted only when its frontmatter identity and document kind match the meeting, including recognized native Steno notes. Identity is checked again for the entire pair before writing, including forced recreation and cached or state-derived paths; a mismatch holds the export instead of relabeling another meeting's content.

State-derived counterpart links are validated even when a deleted export is not being recreated. A foreign replacement holds both writes and leaves the successful-sync state unchanged; a genuinely missing file stays missing without `--force`. When the same-identity export is found at a new location, its obsolete filename does not block the update. Native legacy notes may omit `type`, but an explicit type must be `note`; generated `steno_id` documents always require the matching type.

Generated content is between `stenoai:generated` Markdown comments. Vault-only
notes outside that section remain untouched. Edits inside the section are merged
against the previous generated version when they do not overlap source changes.
If changes overlap, the latest source goes first and the edited version is kept
below under **Preserved vault edits**. On first upgrading an already edited legacy
export, its existing content is retained under **Preserved vault content**.
Custom frontmatter and later human metadata refinements are preserved. Speaker
review properties follow StenoAI; calendar properties follow matched calendar
updates/removal. Independently enriched vault attendee metadata is preserved
while StenoAI has no matched event.

Writes and state replacement are atomic per file, and concurrent runs use a lock.
The two export files and state are not one cross-file transaction. After an
interruption the next run retries, favoring preserved content over silent loss.

## Operation

`custom/obsidian_sync.py` is the source; the installed standalone copy is
`~/scripts/stenoai-sync/stenoai_sync.py`. It uses the standard Python library and
the installed StenoAI CLI. On macOS the CLI defaults to the installed app's
bundled backend; another installation can set `steno_backend` in the sync config
or `STENOAI_BACKEND_PATH`. Other platforms resolve `stenoai`/`stenoai.exe` on PATH.

```sh
stenoai_sync.py --dry-run
stenoai_sync.py --days 365
```

Configuration and state are under `~/.config/stenoai-sync/`. Tests override
`STENOAI_SYNC_CONFIG_DIR` and `STENOAI_USER_DATA_DIR`. The macOS LaunchAgent
watches output, transcripts, and StenoAI's `config.json` for profile changes,
throttles to 30 seconds and has a 15-minute fallback. Update its configured source
paths if storage is moved. The app integration now uses this same rich exporter; the legacy summary-only
engine is no longer connected to Settings.

## App-managed sync

Settings → Integrations now runs this same exporter through the bundled CLI.
Choose the vault root and enable sync; no Python or LaunchAgent installation is
needed for colleagues. It checks every minute while the app is open and after
note changes; Sync now retries immediately. Calendar context refreshes before
export. Speaker suggestions are computed before either vault write.

State is isolated per vault under the StenoAI data directory. If an existing
standalone configuration points to that same vault, its configuration, export
layout and state are reused; both triggers use the same file lock. Source note
deletion preserves exported archive material. New configurations leave daily
note links off until explicitly configured.
