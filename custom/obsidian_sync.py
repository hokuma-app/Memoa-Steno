#!/usr/bin/env python3
"""Sync StenoAI meeting notes and transcripts into the Obsidian vault.

StenoAI keeps each meeting as one local file (`<stem>_summary.md`: frontmatter,
summary sections, then `## Transcript`). The app and optional standalone scheduler use this exporter to create a linked
note + transcript pair with speaker evidence and calendar invitees.

  <vault>/StenoAI/Meeting notes/YYYYMMDD-meetingnotes-<title>.md
  <vault>/StenoAI/Transcripts/YYYYMMDD-transcript-<title>.md

Everything is local: no API, no key, no network.

Usage:
  stenoai_sync.py                 # sync meetings from the last <days_back> days
  stenoai_sync.py --days 30       # override the window
  stenoai_sync.py --dry-run       # show what would be written
  stenoai_sync.py --force         # revisit unchanged sources and recreate missing exports
"""

import argparse
import difflib
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import tempfile
from datetime import datetime, timezone

CONFIG_DIR = os.environ.get("STENOAI_SYNC_CONFIG_DIR") or os.path.expanduser("~/.config/stenoai-sync")
CONFIG_PATH = os.path.join(CONFIG_DIR, "config.json")
STATE_PATH = os.path.join(CONFIG_DIR, "state.json")
LOG_PATH = os.path.join(CONFIG_DIR, "sync.log")

if os.environ.get("STENOAI_USER_DATA_DIR"):
    STENOAI_DATA_DIR = os.environ["STENOAI_USER_DATA_DIR"]
elif sys.platform == "darwin":
    STENOAI_DATA_DIR = os.path.expanduser("~/Library/Application Support/stenoai")
elif sys.platform == "win32":
    STENOAI_DATA_DIR = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "stenoai")
else:
    STENOAI_DATA_DIR = os.path.join(os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share")), "stenoai")

DEFAULT_CONFIG = {
    "vault": os.path.expanduser("~/Obsidian"),
    "notes_folder": "StenoAI/Meeting notes",
    "transcripts_folder": "StenoAI/Transcripts",
    "archive_folders": ["Archive/StenoAI/Meeting notes", "Archive/StenoAI/Transcripts"],
    "note_filename_pattern": "{year}{month}{day}-meetingnotes-{title}",
    "transcript_filename_pattern": "{year}{month}{day}-transcript-{title}",
    "days_back": 7,
    "link_from_daily_notes": True,
    "daily_note_link_heading": "# Meetings",
    # Wait for related source writes to settle before exporting.
    "settle_seconds": 20,
}


# --------------------------------------------------------------------------- #
# infrastructure
# --------------------------------------------------------------------------- #

def log(msg):
    line = "%s  %s" % (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), msg)
    print(line)
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        # keep the log from growing forever
        if os.path.exists(LOG_PATH) and os.path.getsize(LOG_PATH) > 512 * 1024:
            with open(LOG_PATH, "r", encoding="utf-8") as fh:
                tail = fh.readlines()[-1000:]
            with open(LOG_PATH, "w", encoding="utf-8") as fh:
                fh.writelines(tail)
        with open(LOG_PATH, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "r", encoding="utf-8") as fh:
            cfg.update(json.load(fh))
    return cfg


def load_state():
    if os.path.exists(STATE_PATH):
        try:
            with open(STATE_PATH, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError):
            pass
    return {"synced": {}}


def save_state(state):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    atomic_text(STATE_PATH, json.dumps(state, indent=2))


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def steno_output_dir(cfg):
    """StenoAI's notes folder, honouring a custom storage folder set in the app."""
    if cfg.get("steno_output_dir"):
        return os.path.expanduser(cfg["steno_output_dir"])
    base = STENOAI_DATA_DIR
    try:
        with open(os.path.join(STENOAI_DATA_DIR, "config.json"), "r", encoding="utf-8") as fh:
            custom = (json.load(fh).get("storage_path") or "").strip()
        if custom:
            base = custom
    except (OSError, ValueError):
        pass
    return os.path.join(base, "output")


def speaker_settings():
    """Read only identification inputs; never export credentials or embeddings."""
    raw = speaker_source(os.path.join(STENOAI_DATA_DIR, "config.json"))
    config = json.loads(raw) if raw else {}
    if not isinstance(config, dict):
        raise RuntimeError("Speaker settings are unreadable; export will retry")
    return {key: config.get(key) for key in ("identity_matching_enabled", "person_profiles")}


def speaker_revision():
    return sha(json.dumps(speaker_settings(), sort_keys=True, ensure_ascii=False))


def speaker_source(path):
    try:
        with open(path, "r", encoding="utf-8") as stream:
            return stream.read()
    except FileNotFoundError:
        return ""
    except OSError:
        raise RuntimeError("Meeting identification context could not be read; export will retry") from None


def speaker_backend(cfg):
    configured = cfg.get("steno_backend") or os.environ.get("STENOAI_BACKEND_PATH")
    if configured:
        return os.path.expanduser(configured)
    if sys.platform == "darwin":
        return "/Applications/StenoAI.app/Contents/Resources/stenoai/stenoai"
    return shutil.which("stenoai.exe" if sys.platform == "win32" else "stenoai")


def identify_speakers(cfg, stem, sidecar_raw):
    """Run the same model-free ranking as the app, BEFORE either vault write.

    Acoustic analysis already runs during transcription. This reads its saved
    results and scores current profiles; it never loads models or uploads audio.
    A failed query holds back the export instead of silently dropping evidence.
    """
    settings = speaker_settings()
    if settings["identity_matching_enabled"] is False:
        return {"state": "disabled", "channels": {}}
    if not sidecar_raw:
        return {"state": "unavailable", "channels": {}}
    sidecar = json.loads(sidecar_raw)
    if not isinstance(sidecar, dict):
        raise RuntimeError("Speaker analysis is invalid; export will retry")
    backend = speaker_backend(cfg)
    if not backend:
        raise RuntimeError("Speaker identification backend is unavailable; export will retry")
    # Keep an explicit test override, but don't manufacture one in production:
    # the backend's override deliberately takes precedence over custom storage.
    env = dict(os.environ)
    try:
        result = subprocess.run([backend, "suggest-speakers", stem], env=env,
                                capture_output=True, text=True, timeout=60, check=True)
        payload = json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, ValueError):
        raise RuntimeError("Speaker identification could not finish; export will retry") from None
    if not isinstance(payload, dict) or payload.get("success") is not True or not isinstance(payload.get("channels"), dict):
        raise RuntimeError("Speaker identification returned invalid results; export will retry")
    expected = (sidecar.get("diarization_run") or {}).get("run_id")
    # Legacy sidecars use a content token rather than an explicit run ID.
    if expected and payload.get("diarization_run_id") != expected:
        raise RuntimeError("Speaker analysis changed during export; export will retry")
    return dict(payload, state="complete")


def transcript_speaker_turns(transcript, manifest):
    """Only link clusters to transcript turns when exact saved provenance fits.

    Numbers refer to 1-based timestamped lines, not physical Markdown lines.
    Never guess by nearby timestamps when the manifest is missing or stale.
    """
    turns = re.findall(r"^\[(\d{1,3}:\d{2}(?::\d{2})?)\]\s*\[([^\]]+)\]", transcript, re.M)
    if not isinstance(manifest, list) or not manifest or len(turns) != len(manifest):
        return None
    owned = {}
    for number, ((stamp, label), entry) in enumerate(zip(turns, manifest), 1):
        if not isinstance(entry, dict):
            return None
        start = entry.get("start")
        seconds = 0
        for component in stamp.split(":"):
            seconds = seconds * 60 + int(component)
        if not isinstance(start, (int, float)) or not math.isfinite(start) or int(start) != seconds:
            return None
        key = (entry.get("channel"), entry.get("diarization_speaker_id"))
        if all(isinstance(part, str) and part for part in key):
            owned.setdefault(key, []).append((number, label))
    return owned


def speaker_context(stem, transcript, analysis, sidecar_raw, event):
    sidecar = json.loads(sidecar_raw) if sidecar_raw else {}
    owned = transcript_speaker_turns(transcript, sidecar.get("transcript_lines"))
    rows = []
    for channel, clusters in sorted(analysis.get("channels", {}).items()):
        for sid, row in sorted(clusters.items()):
            confirmed = row.get("confirmed_by_user")
            mixed = bool(row.get("contains_multiple_speakers"))
            generic = row.get("review_state") == "generic"
            suggestion = row.get("suggested_name")
            review = ("mixed" if mixed else "kept_generic" if generic else
                      "confirmed" if confirmed else "unconfirmed" if suggestion else "unidentified")
            fragment_ids = [sid, *(row.get("merged_from") or [])]
            turns = sorted(turn for fragment in fragment_ids for turn in (owned or {}).get((channel, fragment), []))
            candidates = [{key: candidate.get(key) for key in
                           ("person_id", "display_name", "distance", "hard_negative_conflict")}
                          for candidate in row.get("candidates", [])]
            rows.append({
                "speaker_ref": channel + "/" + sid, "channel": channel, "cluster_id": sid,
                "merged_cluster_ids": row.get("merged_from") or [],
                "transcript_labels": sorted({label for _, label in turns}),
                "transcript_turns": [number for number, _ in turns],
                "review_status": review,
                "confirmed_name": confirmed if not mixed else None,
                "confirmed_person_id": row.get("confirmed_person_id") if not mixed else None,
                "suggested_name": suggestion if not mixed else None,
                "suggested_person_id": row.get("suggested_person_id") if not mixed else None,
                # Backend 'confirmed' means a strong *suggestion*, never human approval.
                "suggestion_strength": {"confirmed": "likely", "possible": "possible"}.get(row.get("status")),
                "likely_artifact": bool(row.get("is_likely_artifact")),
                "hidden_in_app": bool((row.get("is_likely_artifact") or
                    (row.get("status") == "none" and not candidates)) and not mixed and not generic),
                "speech_seconds": row.get("speech_duration_seconds"),
                "segment_count": row.get("segment_count"), "first_timestamp": row.get("first_timestamp"),
                "match_candidates": candidates, "match_reasons": row.get("reasons") or [],
            })
    invitees = [{key: attendee.get(key) for key in ("name", "email", "self", "status")}
                for attendee in (event or {}).get("attendees") or [] if isinstance(attendee, dict)]
    return {"schema_version": 1, "meeting_id": stem, "analysis_status": analysis["state"],
            "diarization_run_id": analysis.get("diarization_run_id"),
            "transcript_sha256": sha(transcript),
            "turn_mapping": "exact" if owned is not None else "unavailable",
            "turn_numbering": "1-based timestamped transcript lines, excluding headers",
            "match_distance_metric": "cosine distance; lower is more similar, not a probability",
            "calendar_event": {key: (event or {}).get(key) for key in ("id", "title", "start", "end")},
            "calendar_organizer": {key: ((event or {}).get("organizer") or {}).get(key) for key in ("name", "email")},
            "calendar_invitees": invitees, "speakers": rows}


def render_speaker_context(context):
    def cell(value):
        return str(value or "—").replace("|", "\\|").replace("\n", " ").replace("\r", " ")
    lines = ["## Speaker identification", "",
             "Calendar invitees are invited, not verified attendees. Suggested names are unconfirmed; only confirmed names were approved by a person.",
             'A "You" transcript label can be a microphone default. Match distances are not probabilities. Filtered rows are included.', "",
             "Analysis status: **%s**." % context["analysis_status"], ""]
    if context["calendar_invitees"]:
        lines += ["### Calendar invitees", "", "| Name | Email | RSVP | Calendar self |", "| --- | --- | --- | --- |"]
        for invitee in context["calendar_invitees"]:
            lines.append("| %s | %s | %s | %s |" % (cell(invitee["name"]), cell(invitee["email"]), cell(invitee["status"]), "yes" if invitee["self"] else "no"))
        lines.append("")
    if context["speakers"]:
        lines += ["### Speaker review", "", "| Speaker reference | Transcript labels | Identity | Review status | Notes |", "| --- | --- | --- | --- | --- |"]
        for row in context["speakers"]:
            name = row["confirmed_name"] if row["review_status"] == "confirmed" else row["suggested_name"]
            notes = "Filtered in app; possible artifact" if row["likely_artifact"] else ""
            lines.append("| %s | %s | %s | %s | %s |" % tuple(cell(v) for v in
                (row["speaker_ref"], ", ".join(row["transcript_labels"]), name, row["review_status"], notes)))
        lines.append("")
    # JSON is stable, versioned and deliberately allowlisted; never copy raw
    # speaker sidecars/config, which contain biometric embeddings and secrets.
    encoded = json.dumps(context, ensure_ascii=False, indent=2, allow_nan=False)
    fence = "`" * max(3, max((len(m.group()) + 1 for m in re.finditer(r"`+", encoded)), default=3))
    lines += ["### Structured speaker data", "", fence + "json", encoded, fence]
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# reading StenoAI notes
# --------------------------------------------------------------------------- #

def parse_frontmatter_value(raw):
    raw = raw.strip()
    if not raw:
        return ""
    try:
        return json.loads(raw)  # StenoAI writes JSON-quoted strings, numbers, bools, []
    except ValueError:
        return raw


def parse_steno_note(text):
    """Split a StenoAI `_summary.md` into (frontmatter dict, note body, transcript)."""
    meta, body = {}, text
    m = re.match(r"^---\n(.*?)\n---\n?", text, re.S)
    if m:
        for line in m.group(1).split("\n"):
            key, sep, value = line.partition(":")
            if sep and key.strip() and not key.startswith(" "):
                meta[key.strip()] = parse_frontmatter_value(value)
        body = text[m.end():]

    # StenoAI writes "## User Notes" (the My notes tab) after the transcript;
    # those belong with the summary, not inside the transcript file
    user_notes = ""
    u = re.search(r"^## User Notes[ \t]*\n", body, re.M)
    if u:
        user_notes = body[u.end():].strip()
        body = body[:u.start()]

    transcript = ""
    t = re.search(r"^## Transcript[ \t]*\n", body, re.M)
    if t:
        transcript = body[t.end():].strip()
        body = body[:t.start()]
    body = body.strip()
    if user_notes:
        body = (body + "\n\n" if body else "") + "## My notes\n\n" + user_notes
    return meta, body, transcript


def incomplete_reason(meta, raw, transcript):
    """Why a note is not final yet, or None when it is.

    The stages StenoAI writes to one `<stem>_summary.md`:
      1. live-transcription placeholder at stop: `processing: true`
      2. transcript only: `notes_generated: false` (also the end state when
         summarising fails or auto-summarise is off, until Generate notes)
      3. final: summary sections plus the batch transcript
    """
    if meta.get("processing") is True:
        return "still processing"
    if meta.get("transcription_failed") is True:
        return "transcription failed, waiting for a retry"
    if not transcript:
        return "no transcript yet"
    if meta.get("is_live_transcript") is True:
        return "live fallback only, waiting for full transcription"
    return None


def recording_start(stem, meta, path):
    """When the meeting started.

    The stem carries the recording start as epoch ms (`sysaudio-1792058617597-Note`).
    The frontmatter `date` is when processing finished, which can be an hour later.
    """
    m = re.search(r"(?:^|-)(\d{13})(?:-|$)", stem)
    if m:
        return datetime.fromtimestamp(int(m.group(1)) / 1000.0, tz=timezone.utc)
    try:
        return datetime.fromisoformat(str(meta.get("date"))).astimezone(timezone.utc)
    except ValueError:
        return datetime.fromtimestamp(os.path.getmtime(path), tz=timezone.utc)


# --------------------------------------------------------------------------- #
# formatting
# --------------------------------------------------------------------------- #

INVALID_FILENAME = re.compile(r'[\\/:*?"<>|\x00-\x1f#^\[\]]')


def safe_alias(name):
    """Wikilink aliases cannot contain | [ ] # ^ without breaking the link."""
    return re.sub(r"\s+", " ", re.sub(r"[|\[\]#^]", "-", name or "Untitled")).strip()


def safe_filename(name, limit=140):
    name = INVALID_FILENAME.sub("-", (name or "Untitled").strip())
    name = re.sub(r"\s+", " ", name).strip(" .-")
    return (name or "Untitled")[:limit].strip()


def yaml_escape(value):
    return '"%s"' % str(value).replace("\\", "\\\\").replace('"', '\\"')


def frontmatter(stem, meta, kind, counterpart_link, dt):
    title = meta.get("title") or "Untitled"
    lines = ["---"]
    lines.append("steno_id: %s" % stem)
    lines.append("title: %s" % yaml_escape(title + (" - Transcript" if kind == "transcript" else "")))
    lines.append("type: %s" % ("transcript" if kind == "transcript" else "note"))
    lines.append("source: stenoai")
    lines.append("created: %s" % dt.strftime("%Y-%m-%dT%H:%M:%S.000Z"))
    duration = meta.get("duration_seconds")
    if isinstance(duration, (int, float)) and duration:
        lines.append("duration_minutes: %s" % round(duration / 60.0))
    if meta.get("language"):
        lines.append("language: %s" % meta["language"])
    event = meta.get("_calendar_event") or {}
    invited = [a for a in event.get("attendees") or [] if isinstance(a, dict)]
    names = [a.get("name") or a.get("email") for a in invited if a.get("name") or a.get("email")]
    if names:
        # From the calendar event StenoAI matched to this recording
        lines.append("attendees: [%s]" % ", ".join(yaml_escape(n) for n in names))
        emails = [a["email"] for a in invited if a.get("email")]
        if emails:
            lines.append("attendee_emails: [%s]" % ", ".join(yaml_escape(e) for e in emails))
        lines.append("attendees_source: calendar")
        lines.append("calendar_event: %s" % yaml_escape(event.get("title") or ""))
    else:
        # No calendar match; the process-daily-note calendar step fills it in
        lines.append("attendees: []")
        lines.append("attendees_unresolved: true")
    participants = meta.get("_participants") or []
    if participants:
        lines.append("participants: [%s]" % ", ".join(yaml_escape(n) for n in participants))
    context = meta.get("_speaker_context")
    if context:
        lines.append("speaker_identification_schema: 1")
        lines.append("speaker_identification_status: " + context["analysis_status"])
        for key, field, status in (("confirmed_speakers", "confirmed_name", "confirmed"),
                                   ("suggested_speakers", "suggested_name", "unconfirmed")):
            names = sorted({row[field] for row in context["speakers"] if row["review_status"] == status and row[field]})
            lines.append(key + ": " + json.dumps(names, ensure_ascii=False))
        lines.append("participants_source: steno_summary")
    lines.append("transcript_complete: true")
    lines.append("summary_available: %s" % ("true" if meta.get("_summary_available") else "false"))
    lines.append("summary_stale: %s" % ("true" if meta.get("notes_stale") else "false"))
    key = "note" if kind == "transcript" else "transcript"
    if counterpart_link:
        lines.append('%s: "[[%s]]"' % (key, counterpart_link))
    lines.append("---")
    return "\n".join(lines)


def render_note(stem, meta, body, transcript_link, dt):
    out = [frontmatter(stem, meta, "note", transcript_link, dt), ""]
    out.append(body or "_No AI summary was available for this meeting._")
    if meta.get("_speaker_context"):
        out += ["", render_speaker_context(meta["_speaker_context"])]
    description = (meta.get("_calendar_event") or {}).get("description")
    if description:
        out += ["", "## Invitation", "", description]
    return "\n".join(out).rstrip() + "\n"


def render_transcript(stem, meta, transcript, note_link, dt):
    out = [frontmatter(stem, meta, "transcript", note_link, dt), ""]
    out.append("# Transcript for: %s" % (meta.get("title") or "Untitled"))
    out.append("")
    out.append(transcript)
    if meta.get("_speaker_context"):
        out += ["", render_speaker_context(meta["_speaker_context"])]
    return "\n".join(out).rstrip() + "\n"


# --------------------------------------------------------------------------- #
# vault writing
# --------------------------------------------------------------------------- #

def filename_for(pattern, dt, title):
    return pattern.format(
        year="%04d" % dt.year, month="%02d" % dt.month, day="%02d" % dt.day,
        title=title,
    ) + ".md"


def already_archived(cfg, filename):
    for folder in cfg.get("archive_folders") or []:
        if os.path.exists(os.path.join(cfg["vault"], folder, filename)):
            return True
    return False


def read_text(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return None


def atomic_text(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".steno-sync-", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def write_file(path, content, dry_run):
    if read_text(path) == content:
        return "unchanged"
    if dry_run:
        return "would write"
    atomic_text(path, content)
    return "written"


AUTO_START = "<!-- stenoai:generated:start -->"
AUTO_END = "<!-- stenoai:generated:end -->"
MANAGED_KEYS = {"steno_id", "title", "type", "source", "created", "duration_minutes", "language",
                "attendees", "attendee_emails", "attendees_source", "attendees_unresolved",
                "calendar_event", "participants", "note", "transcript", "transcript_complete", "summary_available", "summary_stale",
                "speaker_identification_schema", "speaker_identification_status", "confirmed_speakers", "suggested_speakers", "participants_source"}


def split_document(text):
    match = re.match(r"^---\n(.*?)\n---\n?", text or "", re.S)
    return (match.group(1), text[match.end():].strip()) if match else ("", (text or "").strip())


def frontmatter_blocks(header):
    blocks = {}
    key = None
    for line in header.splitlines():
        match = re.match(r"^([^\s:]+):", line)
        if match:
            key = match.group(1)
            blocks[key] = []
        if key:
            blocks[key].append(line)
    return {key: "\n".join(lines) for key, lines in blocks.items()}


def merged_frontmatter(current, generated, previous=None):
    """Source owns links/state/participants; retain human metadata refinements."""
    old, _ = split_document(current)
    new, _ = split_document(generated)
    existing, fresh = frontmatter_blocks(old), frontmatter_blocks(new)
    baseline = frontmatter_blocks(previous or "")
    authoritative = {"steno_id", "type", "source", "note", "transcript", "participants",
                     "transcript_complete", "summary_available", "summary_stale",
                     "speaker_identification_schema", "speaker_identification_status", "confirmed_speakers", "suggested_speakers", "participants_source"}
    # Calendar-sourced values follow calendar edits. Preserve independently
    # enriched vault attendees only while StenoAI has no matched calendar event.
    if fresh.get("attendees_source") == "attendees_source: calendar":
        authoritative.update({"attendees", "attendee_emails", "attendees_source", "attendees_unresolved", "calendar_event"})
    elif baseline.get("attendees_source") == "attendees_source: calendar":
        authoritative.update({"attendees", "attendee_emails", "attendees_source", "attendees_unresolved", "calendar_event"})
    for key, value in existing.items():
        if key not in MANAGED_KEYS:
            fresh[key] = value
        elif key not in authoritative and key in baseline and value != baseline[key]:
            fresh[key] = value
        elif (not previous and key.startswith("attendee") and key in existing
              and not re.fullmatch(r"attendees:\s*\[\s*\]", existing.get("attendees", ""))):
            fresh[key] = value
    return "---\n" + "\n".join(fresh.values()) + "\n---\n\n"


def three_way(old, current, new):
    if current == old:
        return new
    if new == old or current == new:
        return current
    lines = old.splitlines(keepends=True)
    def edits(target):
        other = target.splitlines(keepends=True)
        return [(a, b, other[c:d]) for op, a, b, c, d in
                difflib.SequenceMatcher(None, lines, other, autojunk=False).get_opcodes() if op != "equal"]
    user, source = edits(current), edits(new)
    for a, b, value in user:
        for c, d, replacement in source:
            overlap = max(a, c) < min(b, d) or (a == b and c <= a <= d) or (c == d and a <= c <= b)
            if overlap and (a, b, value) != (c, d, replacement):
                return None
    combined = {(a, b, tuple(value)) for a, b, value in user + source}
    for a, b, value in sorted(combined, reverse=True):
        lines[a:b] = value
    return "".join(lines)


def refresh_managed(current, generated, entry, prefix):
    _, new_body = split_document(generated)
    if current is None:
        return merged_frontmatter("", generated) + AUTO_START + "\n" + new_body + "\n" + AUTO_END + "\n", new_body
    _, body = split_document(current)
    if AUTO_START in body or AUTO_END in body:
        if body.count(AUTO_START) != 1 or body.count(AUTO_END) != 1 or body.index(AUTO_START) > body.index(AUTO_END):
            raise RuntimeError("Managed section markers were edited; preserved file without overwriting")
        before, remainder = body.split(AUTO_START, 1)
        existing, after = remainder.split(AUTO_END, 1)
        existing = existing.strip()
        baseline = entry.get(prefix + "_base")
        merged = three_way(baseline, existing, new_body) if baseline is not None else (new_body if sha(existing) == entry.get(prefix + "_managed_hash") else None)
        if merged is None:
            # Source stays authoritative; keep the complete user's version
            # outside the generated block rather than dropping conflicting edits.
            after = after.rstrip() + "\n\n## Preserved vault edits\n\n" + existing + "\n"
            merged = new_body
            log("  preserved overlapping vault edits outside the refreshed section")
        result = before + AUTO_START + "\n" + merged.strip() + "\n" + AUTO_END + after
    elif sha(current) == entry.get(prefix + "_hash") or current == generated:
        result = AUTO_START + "\n" + new_body + "\n" + AUTO_END
    else:
        # No previous body baseline for an edited legacy export: keep it intact.
        result = AUTO_START + "\n" + new_body + "\n" + AUTO_END + "\n\n## Preserved vault content\n\n" + body
        log("  retained existing vault content while adding a managed source section")
    return merged_frontmatter(current, generated, entry.get(prefix + "_frontmatter")) + result.strip() + "\n", new_body


def native_sync_index(cfg):
    source = cfg.get("native_sync_state_path")
    if not source:
        return {}
    try:
        with open(source, encoding="utf-8") as fh:
            return json.load(fh).get("notes", {})
    except (OSError, ValueError, AttributeError):
        return {}


def indexed_document(cfg, relative):
    if not isinstance(relative, str) or os.path.isabs(relative):
        return None
    vault = os.path.realpath(cfg["vault"])
    target = os.path.join(vault, relative)
    if (os.path.commonpath([vault, os.path.realpath(target)]) != vault
            or os.path.islink(target) or not os.path.isfile(target)):
        return None
    return read_text(target)


def index_locations(cfg, synced=None):
    found = {}
    roots = [cfg["notes_folder"], cfg["transcripts_folder"], *(cfg.get("archive_folders") or [])]
    for folder in dict.fromkeys(roots):
        base = os.path.join(cfg["vault"], folder)
        if not os.path.isdir(base):
            continue
        for directory, _, files in os.walk(base):
            for filename in files:
                path = os.path.join(directory, filename)
                if not filename.endswith(".md") or os.path.islink(path):
                    continue
                header, _ = split_document(read_text(path))
                match = re.search(r"^steno_id:\s*(.+)$", header, re.M)
                kind = re.search(r"^type:\s*(note|transcript)\s*$", header, re.M)
                if match and kind:
                    stem = str(parse_frontmatter_value(match.group(1)))
                    found.setdefault((stem, kind.group(1)), []).append(os.path.relpath(path, cfg["vault"]))
    # Native Settings exports used arbitrary root/folder paths. Adopt only an
    # indexed file whose on-disk identity agrees; the old index had no vault ID.
    candidates = [(stem, "note", entry.get("vaultRelPath"))
                  for stem, entry in native_sync_index(cfg).items() if isinstance(entry, dict)]
    for stem, entry in (synced or {}).items():
        for kind in ("note", "transcript"):
            candidates.append((stem, kind, entry.get(kind + "_rel")))
    for stem, kind, relative in candidates:
        current = indexed_document(cfg, relative)
        if current is None:
            continue
        header, _ = split_document(current)
        fields = {key: parse_frontmatter_value(value.split(":", 1)[1].strip())
                  for key, value in frontmatter_blocks(header).items()}
        rich = fields.get("steno_id") == stem and fields.get("type") == kind
        native = kind == "note" and fields.get("source") == "Steno" and fields.get("steno_stem") == stem
        if rich or native:
            paths = found.setdefault((stem, kind), [])
            if relative not in paths:
                paths.append(relative)
    return found


def canonical_transcript(cfg, stem):
    directory = cfg.get("steno_transcript_dir") or os.path.join(os.path.dirname(steno_output_dir(cfg)), "transcripts")
    content = read_text(os.path.join(directory, stem + "_transcript.txt")) or ""
    if content.startswith("Session:"):
        lines = content.splitlines()
        separator = next((i for i, line in enumerate(lines[:12]) if re.fullmatch(r"={20,}\s*", line)), None)
        if separator is not None:
            content = "\n".join(lines[separator + 1:])
    return content.strip()


CONTINUATION = re.compile(r"^--- (?:Resumed|Continued recording)\b[^\n]*---[ \t]*$", re.M)


def select_transcript(canonical, embedded):
    """Keep TXT speaker edits, but never drop an embedded continuation.

    Old append writers only updated the note. An exact prefix ending at a
    continuation boundary proves the embedded source extends that TXT. Other
    disagreements on continued meetings need repair, not a guessed merge.
    """
    if not canonical or not embedded:
        return canonical or embedded
    if not (CONTINUATION.search(embedded) or CONTINUATION.search(canonical)):
        return canonical
    if any(canonical == embedded[:m.start()].strip() for m in CONTINUATION.finditer(embedded)):
        return embedded
    # Speaker labels may legitimately change only in TXT. Compare speech and
    # continuation boundaries without those labels; never normalize speech away.
    def speech(text):
        return re.sub(r"^(\[\d{1,3}:\d{2}(?::\d{2})?\])\s*\[[^\]\n]+\]", r"\1", text, flags=re.M)
    canonical_speech, embedded_speech = speech(canonical), speech(embedded)
    if canonical_speech == embedded_speech or any(
            embedded_speech == canonical_speech[:m.start()].strip()
            for m in CONTINUATION.finditer(canonical_speech)):
        return canonical
    raise RuntimeError("Continued transcript sources disagree; export will retry after source repair")


def document_identity_matches(current, stem, kind):
    """Adopt a file only on frontmatter identity, never body text or a filename."""
    header, _ = split_document(current)
    blocks = frontmatter_blocks(header)
    fields = {key: parse_frontmatter_value(value.split(":", 1)[1].strip())
              for key, value in blocks.items()}
    for key in ('steno_id', 'type', 'source', 'steno_stem'):
        if len(re.findall(r'^' + key + r':', header, re.M)) > 1:
            return False
    if 'steno_id' in fields:
        return fields['steno_id'] == stem and fields.get('type') == kind
    return (kind == 'note' and fields.get('source') == 'Steno'
            and fields.get('steno_stem') == stem
            and ('type' not in fields or fields['type'] == kind))


def unique_names(cfg, dt, title, stem):
    """Two meetings on one day can get the same AI title; never overwrite the other."""
    base = safe_filename(title)
    for n in range(1, 50):
        candidate = base if n == 1 else "%s (%d)" % (base, n)
        note = filename_for(cfg["note_filename_pattern"], dt, candidate)
        tr = filename_for(cfg["transcript_filename_pattern"], dt, candidate)
        destinations = ((cfg['notes_folder'], note, 'note'),
                        (cfg['transcripts_folder'], tr, 'transcript'))
        paths = [os.path.join(cfg['vault'], folder, name) for folder, name, _ in destinations]
        if os.path.normcase(os.path.abspath(paths[0])) == os.path.normcase(os.path.abspath(paths[1])):
            raise RuntimeError("Note and transcript destinations must be distinct")
        if all(not os.path.lexists(path) or (
                os.path.isfile(path) and not os.path.islink(path)
                and document_identity_matches(read_text(path), stem, kind))
               for path, (_, _, kind) in zip(paths, destinations)):
            return note, tr
    raise RuntimeError("no free filename for %r" % title)


def link_from_daily_note(cfg, dt, note_rel_path, title, dry_run):
    """Add `- HH:MM - [[...|Title]]` under the Meetings heading of the daily note."""
    local = dt.astimezone()
    daily_path = os.path.join(cfg["vault"], "%s.md" % local.strftime("%Y-%m-%d"))
    heading = cfg["daily_note_link_heading"]
    link_target = note_rel_path[:-3] if note_rel_path.endswith(".md") else note_rel_path
    stamp = local.strftime("%H:%M")
    link = "- %s - [[%s|%s]]" % (stamp, link_target, safe_alias(title))

    existing = read_text(daily_path) or ""
    if link_target in existing:
        return "already linked"
    if dry_run:
        return "would link in %s" % os.path.basename(daily_path)

    if heading in existing:
        lines = existing.split("\n")
        idx = next(i for i, ln in enumerate(lines) if ln.strip() == heading.strip())
        end = idx + 1
        while end < len(lines) and not lines[end].startswith("# "):
            end += 1
        while end > idx + 1 and not lines[end - 1].strip():
            end -= 1
        # keep the section in chronological order where lines are timestamped
        insert_at = end
        for i in range(idx + 1, end):
            m = re.match(r"^-\s*(\d{2}:\d{2})\s", lines[i])
            if m and m.group(1) > stamp:
                insert_at = i
                break
        lines.insert(insert_at, link)
        new_content = "\n".join(lines)
    else:
        prefix = existing.rstrip("\n")
        new_content = (prefix + "\n\n\n" if prefix else "") + heading + "\n" + link + "\n"

    with open(daily_path, "w", encoding="utf-8") as fh:
        fh.write(new_content if new_content.endswith("\n") else new_content + "\n")
    return "linked in %s" % os.path.basename(daily_path)


def rename_for_title(cfg, entry, dt, title, stem, dry_run):
    """Follow a title change in StenoAI (e.g. "Note" -> the generated title).

    Only while both vault files are exactly as this script wrote them: once they
    are edited or archived, the names in the vault are left alone. Returns the
    (note, transcript) filenames to use from now on.
    """
    old_note, old_tr = entry["note_file"], entry["transcript_file"]
    old_paths = [
        os.path.join(cfg["vault"], cfg["notes_folder"], old_note),
        os.path.join(cfg["vault"], cfg["transcripts_folder"], old_tr),
    ]
    for p, hash_key in zip(old_paths, ("note_hash", "transcript_hash")):
        current = read_text(p)
        if current is None or sha(current) != entry.get(hash_key):
            return old_note, old_tr

    new_note, new_tr = unique_names(cfg, dt, title, stem)
    if (new_note, new_tr) == (old_note, old_tr):
        return old_note, old_tr
    log("  renaming:     %s -> %s" % (old_note, new_note))
    if dry_run:
        return new_note, new_tr

    for old_path, new_name in zip(old_paths, (new_note, new_tr)):
        os.replace(old_path, os.path.join(os.path.dirname(old_path), new_name))

    # repoint the daily-note link; the alias still shows the old title
    if entry.get("linked"):
        daily_path = os.path.join(cfg["vault"], "%s.md" % dt.strftime("%Y-%m-%d"))
        daily = read_text(daily_path)
        old_target = "%s/%s" % (cfg["notes_folder"], old_note[:-3])
        if daily and old_target in daily:
            new_target = "%s/%s" % (cfg["notes_folder"], new_note[:-3])
            daily = re.sub(
                r"\[\[%s\|[^\]]*\]\]" % re.escape(old_target),
                lambda _m: "[[%s|%s]]" % (new_target, safe_alias(title)),
                daily,
            )
            with open(daily_path, "w", encoding="utf-8") as fh:
                fh.write(daily)
    return new_note, new_tr


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #

def sync_one(cfg, synced, path, dry_run, force):
    stem = os.path.basename(path)[:-len("_summary.md")]
    raw = read_text(path)
    if raw is None:
        return False
    calendar_raw = speaker_source(path[:-len("_summary.md")] + "_calendar.json")
    canonical = canonical_transcript(cfg, stem)
    speakers_path = path[:-len("_summary.md")] + "_speakers.json"
    sidecar_raw = speaker_source(speakers_path)
    profile_revision = speaker_revision()
    source_hash = sha(json.dumps(["managed-v4-coherent-transcripts", raw, calendar_raw, canonical, sidecar_raw, profile_revision]))
    entry = synced.get(stem) or {}
    if entry.get("source_hash") == source_hash and not force:
        return False
    meta, body, embedded = parse_steno_note(raw)
    transcript = select_transcript(canonical, embedded)
    unfinished = incomplete_reason(meta, raw, transcript)
    if unfinished:
        if entry.get("waiting_hash") != source_hash:
            log("waiting (%s): %s [%s]" % (unfinished, meta.get("title"), stem))
            if not dry_run:
                synced[stem] = dict(entry, waiting_hash=source_hash, waiting_reason=unfinished)
        return False
    try:
        calendar_data = json.loads(calendar_raw) if calendar_raw else {}
        if not isinstance(calendar_data, dict):
            raise ValueError("Invalid calendar context")
        event = calendar_data.get("event")
        if event is not None and not isinstance(event, dict):
            raise ValueError("Invalid calendar event")
        if event is not None and not isinstance(event.get("attendees") or [], list):
            raise ValueError("Invalid calendar invitees")
        if event is not None and not isinstance(event.get("organizer") or {}, dict):
            raise ValueError("Invalid calendar organizer")
        meta["_calendar_event"] = event
    except ValueError:
        raise RuntimeError("Calendar context could not be read; export will retry") from None
    analysis = identify_speakers(cfg, stem, sidecar_raw)
    meta["_speaker_context"] = speaker_context(stem, transcript, analysis, sidecar_raw, meta["_calendar_event"])
    # Ranking invokes a separate backend process. Never combine its answer with
    # a transcript/review/profile revision that changed while it was running.
    if (read_text(path) != raw or canonical_transcript(cfg, stem) != canonical
            or speaker_source(speakers_path) != sidecar_raw
            or speaker_source(path[:-len("_summary.md")] + "_calendar.json") != calendar_raw
            or speaker_revision() != profile_revision):
        raise RuntimeError("Meeting or speaker evidence changed during export; export will retry")
    participants = re.search(r"^## Participants[ \t]*\n(.*?)(?=^## |\Z)", body, re.M | re.S)
    meta["_participants"] = [p.strip() for p in participants.group(1).strip().split(",") if p.strip()] if participants else []
    meta["_summary_available"] = meta.get("notes_generated") is not False and bool(re.search(r"^## Summary[ \t]*$", raw, re.M))
    title = meta.get("title") or "Untitled"
    dt = recording_start(stem, meta, path)
    local = dt.astimezone()
    locations = cfg.get("_locations")
    if locations is None:
        locations = index_locations(cfg, synced)
    note_name, tr_name = (entry.get("note_file"), entry.get("transcript_file"))
    if not note_name or not tr_name:
        note_name, tr_name = unique_names(cfg, local, title, stem)
    note_paths = locations.get((stem, "note"), [])
    tr_paths = locations.get((stem, "transcript"), [])
    default_note = "%s/%s" % (cfg["notes_folder"], note_name)
    default_tr = "%s/%s" % (cfg["transcripts_folder"], tr_name)
    # Follow existing/moved files by ID; never recreate a deliberately removed
    # export with a recorded hash. Filenames remain stable to preserve links.
    if not note_paths and (not entry.get("note_hash") or force):
        note_paths = [default_note]
    if not tr_paths and (not entry.get("transcript_hash") or force):
        tr_paths = [default_tr]
    primary_note = note_paths[0] if note_paths else entry.get("note_rel", default_note)
    primary_tr = tr_paths[0] if tr_paths else entry.get("transcript_rel", default_tr)
    # Check writes AND link-only counterparts before either write. A removed
    # export stays removed, but a foreign replacement must not become a link.
    # When an export moved, only its discovered paths matter, not obsolete names.
    targets = set()
    for kind, paths in (("note", note_paths or [primary_note]),
                        ("transcript", tr_paths or [primary_tr])):
        for rel in paths:
            dest = os.path.join(cfg["vault"], rel)
            vault = os.path.realpath(cfg["vault"])
            target = os.path.normcase(os.path.realpath(dest))
            if os.path.commonpath([vault, os.path.realpath(dest)]) != vault:
                raise RuntimeError("Export target escapes the vault")
            if target in targets:
                raise RuntimeError("Note and transcript destinations must be distinct")
            targets.add(target)
            if os.path.lexists(dest) and (os.path.islink(dest) or not os.path.isfile(dest)
                    or not document_identity_matches(read_text(dest), stem, kind)):
                raise RuntimeError("Export target identity does not match; preserved existing files")
    generated = {"note": render_note(stem, meta, body, primary_tr, dt),
                 "transcript": render_transcript(stem, meta, transcript, primary_note, dt)}
    new_entry = dict(entry)
    new_entry.pop("waiting_hash", None)
    new_entry.pop("waiting_reason", None)
    changed = False
    for kind, paths in (("note", note_paths), ("transcript", tr_paths)):
        prefix = "note" if kind == "note" else "transcript"
        for rel in paths:
            dest = os.path.join(cfg["vault"], rel)
            vault = os.path.realpath(cfg["vault"])
            if os.path.commonpath([vault, os.path.realpath(dest)]) != vault:
                raise RuntimeError("Export target escapes the vault")
            current = read_text(dest)
            merge_entry = entry
            if kind == "note" and current and not entry.get("note_hash"):
                native = native_sync_index(cfg).get(stem, {})
                header, _ = split_document(current)
                if "steno_stem:" in header and native.get("vaultRelPath") == rel:
                    merge_entry = dict(entry)
                    if sha(current) == native.get("lastWrittenHash"):
                        merge_entry.update(note_hash=sha(current), note_frontmatter=header)
                    else:
                        # Preserve custom native metadata as well as the body.
                        # A fresh baseline marks its values as human changes.
                        merge_entry["note_frontmatter"] = split_document(generated[kind])[0]
            content, baseline = refresh_managed(current, generated[kind], merge_entry, prefix)
            outcome = write_file(dest, content, dry_run)
            if outcome != "unchanged":
                log("  %s: %s -> %s" % (kind, outcome, rel))
                changed = True
            new_entry[prefix + "_hash"] = sha(content)
            new_entry[prefix + "_base"] = baseline
            new_entry[prefix + "_managed_hash"] = sha(baseline)
            new_entry[prefix + "_frontmatter"] = split_document(generated[kind])[0]
    if cfg.get("link_from_daily_notes", True) and note_paths and not entry.get("linked"):
        log("  daily note: %s" % link_from_daily_note(cfg, dt, primary_note, title, dry_run))
        new_entry["linked"] = True
    new_entry.update({"title": title, "note_file": note_name, "transcript_file": tr_name,
                      "note_rel": primary_note, "transcript_rel": primary_tr,
                      "date": local.isoformat(), "source_hash": source_hash,
                      "synced_at": datetime.now().isoformat(timespec="seconds")})
    if not dry_run:
        synced[stem] = new_entry
    return changed


def source_mtime(path):
    """Include speaker, transcript and calendar updates when scheduling a sync."""
    base = path[:-len("_summary.md")]
    candidates = [path, base + "_calendar.json", base + "_speakers.json",
                  os.path.join(os.path.dirname(os.path.dirname(path)), "transcripts",
                               os.path.basename(base) + "_transcript.txt")]
    stamps = []
    for candidate in candidates:
        try:
            stamps.append(os.path.getmtime(candidate))
        except FileNotFoundError:
            pass
    return max(stamps or [0])


def sync(cfg, days, dry_run, force):
    out_dir = steno_output_dir(cfg)
    if not os.path.isdir(out_dir):
        log("StenoAI notes folder not found: %s" % out_dir)
        return 0

    state = load_state()
    synced = state.setdefault("synced", {})
    cutoff = time.time() - days * 86400
    paths = [
        os.path.join(out_dir, name) for name in os.listdir(out_dir)
        if name.endswith("_summary.md")
        and (source_mtime(os.path.join(out_dir, name)) >= cutoff
             or name[:-len("_summary.md")] in synced)
    ]
    # This run was usually started by the very write that saved the note, so wait
    # for it to settle here: skipping it would leave it until the 15-minute run.
    settle = float(cfg.get("settle_seconds") or 0)
    youngest = max([source_mtime(p) for p in paths] or [0])
    wait = settle - (time.time() - youngest)
    if 0 < wait <= settle and not dry_run:
        time.sleep(wait)
    paths = [p for p in paths if os.path.exists(p)]
    paths.sort(key=source_mtime)

    cfg = dict(cfg, _locations=index_locations(cfg, synced))
    # Per-note outcome for StenoAI's "In vault" line: the last error stays
    # until the note syncs cleanly again.
    errors = state.setdefault("errors", {})
    written = 0
    try:
        for path in paths:
            stem = os.path.basename(path)[:-len("_summary.md")]
            try:
                if sync_one(cfg, synced, path, dry_run, force):
                    written += 1
                errors.pop(stem, None)
            except (OSError, RuntimeError, ValueError) as exc:
                # one bad note must not block the others
                log("ERROR on %s: %s" % (os.path.basename(path), exc))
                errors[stem] = {"at": datetime.now().isoformat(timespec="seconds"), "message": str(exc)[:300]}
    finally:
        if not dry_run:
            state["last_run"] = datetime.now().isoformat(timespec="seconds")
            save_state(state)
    if written or dry_run:
        log("done: %d new/updated, %d checked" % (written, len(paths)))
    return written


def main(argv=None):
    ap = argparse.ArgumentParser(description="Sync StenoAI meetings into Obsidian")
    ap.add_argument("--days", type=int, help="how many days back to look")
    ap.add_argument("--dry-run", action="store_true", help="print actions without writing")
    ap.add_argument("--force", action="store_true",
                    help="revisit unchanged sources and recreate missing exports; preserve vault edits")
    args = ap.parse_args(argv)

    cfg = load_config()
    if not os.path.isdir(cfg["vault"]):
        print("Vault not found: %s" % cfg["vault"], file=sys.stderr)
        return 2
    days = args.days or int(cfg.get("days_back", 7))
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(os.path.join(CONFIG_DIR, "sync.lock"), "a+") as lock:
        if os.name == "posix":
            import fcntl
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return 0
        elif os.name == "nt":
            import msvcrt
            lock.seek(0)
            lock.write("0")
            lock.flush()
            lock.seek(0)
            try:
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                return 0
        sync(cfg, days, args.dry_run, args.force)
    return 0


if __name__ == "__main__":
    sys.exit(main())
