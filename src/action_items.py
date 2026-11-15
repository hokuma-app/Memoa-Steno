"""Action items from a model's Markdown: merge, tidy and sanity-check.

Small local models write an action item as an owner and a date on one line and the
task on the next ("- **Speaker 2** (due 2026-10-30)" then an indented line), or leave
the task out altogether. This module turns the lines of a ``## Action Items`` section
into whole items (``Name: task (due YYYY-MM-DD)``), never loses task text, and drops
what cannot be an action item (an owner and a date without a task). The JavaScript
twin in ``app/action-items.js`` follows the same rules and is checked against the
same cases (``tests/fixtures/action_item_cases.json``).
"""

from __future__ import annotations

import calendar
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Iterable, Optional

_BULLET = re.compile(r'^(\s*)(?:[-*+]|\d+[.)])\s+(\S.*)$')
_CHECKBOX = re.compile(r'^\[([ xX])\]\s*(.*)$')
# A deadline marker: "(due <words or date>)", "(deadline: ...)" or "(by YYYY-MM-DD)". The model writes the
# words as spoken ("(due vrijdag)"); ``strip_unsupported_due_dates`` converts them. "(due to the delay)" is
# ordinary text, not a marker.
_DUE = re.compile(
    r'\(\s*(?:(?:due|deadline)\b\s*:?\s*(?!to\b|diligence\b|date\b)|by\s*:?\s*(?=\d{4}-\d{2}-\d{2}))'
    r'([^()\n]{0,60}?)\s*\)',
    re.IGNORECASE,
)
_DUE_EMPTY = {
    '', 'yyyy-mm-dd', 'unknown', 'n/a', 'na', 'none', 'null', 'tbd', 'tba', 'not stated', 'not specified', '-', '\u2014',
}
_SPEAKER_LABEL = re.compile(r'^(?:speaker|spreker)s?[ _]?\d+$', re.IGNORECASE)
_GROUPS = {
    'team', 'team members', 'the team', 'het team', 'teamleden', 'teamlid', 'management', 'het management',
    'everyone', 'everybody', 'all', 'iedereen', 'allen', 'directie', 'de directie', 'mt', 'staff',
    'medewerkers', 'attendees', 'participants', 'deelnemers', 'aanwezigen', 'both', 'beiden',
}
_PARTICLES = {'de', 'den', 'der', 'van', 'von', 'ten', 'ter', 'te', 'het', "'t", 'la', 'le', 'du', 'da', 'di', 'al', 'el'}
_OWN_OWNER = re.compile(r'^(?:\*\*[^*\n]{1,60}?(?::\*\*|\*\*:)|\[[^\[\]\n]{1,60}\]:|[^:\n(]{1,40}:)\s+\S')


@dataclass
class ActionEntry:
    checked: bool
    text: str
    # Nested bullets under a task, as plain text and as the raw lines.
    nested: list = field(default_factory=list)
    nested_raw: list = field(default_factory=list)
    merged: bool = False
    # Row ranges (start, end exclusive) of the input this entry was made from.
    spans: list = field(default_factory=list)


def _split_due(text: str) -> tuple:
    """(text without any due marker, last due value or None). The value is a date or the words as written."""
    found = [m.group(1).strip() for m in _DUE.finditer(text)]
    found = [f for f in found if f.lower().strip(' .') not in _DUE_EMPTY]
    return re.sub(r'\s{2,}', ' ', _DUE.sub('', text)).strip(), (found[-1] if found else None)


def _owner_of(rest: str) -> tuple:
    """(owner, strength) for a head without task text, or (None, None).

    strong: written as an owner (bold, brackets, trailing colon), a speaker label or
    a group; weak: a short run of capitalised words (a name)."""
    s = rest.strip()
    marked = False
    for pattern in (r'^\*\*(.+?):\*\*$', r'^\*\*(.+?)\*\*:?$', r'^\[(.+?)\]:?$'):
        m = re.match(pattern, s)
        if m:
            s, marked = m.group(1).strip(), True
            break
    else:
        if s.endswith(':'):
            s, marked = s[:-1].strip(), True
    if not s:
        return ('', 'strong')
    words = s.split()
    if len(s) > 60 or ':' in s or len(words) > 6:
        return (None, None)
    if marked or _SPEAKER_LABEL.match(s) or s.lower() in _GROUPS:
        return (s, 'strong')
    if len(words) <= 3 and words[0][0].isupper() and all(w[0].isupper() or w.lower() in _PARTICLES for w in words):
        return (s, 'weak')
    return (None, None)


def _plain(text: str) -> str:
    text = text.strip()
    m = _BULLET.match(text)
    if m:
        text = m.group(2).strip()
    c = _CHECKBOX.match(text)
    return c.group(2).strip() if c else text


def _assemble(owner: str, task: str, due: Optional[str]) -> str:
    out = f'{owner}: {task}' if owner else task
    return f'{out} (due {due})' if due else out


def parse_action_entries(lines: Iterable[str]) -> tuple:
    entries, dropped, _ = parse_action_entries_with_spans(lines)
    return entries, dropped


def parse_action_entries_with_spans(lines: Iterable[str]) -> tuple:
    """(entries, left-out count, row ranges of the left-out items).

    Entries of a ``## Action Items`` section and how many were left out.

    A line starting a bullet at the section's first indent opens an item; indented
    plain lines continue it. When an item only has an owner and a date, its
    continuation (plain lines or nested bullets) is the task; with nothing after it, it
    merges with the next item that has no owner of its own, else it is left out and
    counted. Nested bullets under an item that has its own task stay separate."""
    rows = [str(line).rstrip('\r\n') for line in lines]
    base: Optional[int] = None
    for row in rows:
        m = _BULLET.match(row)
        if m:
            base = len(m.group(1).expandtabs(2))
            break
    if base is None:
        return [], 0, []

    heads = []  # (checked, text, plain continuation, nested raw)
    i = 0
    while i < len(rows):
        m = _BULLET.match(rows[i])
        if not m or len(m.group(1).expandtabs(2)) > base:
            i += 1
            continue
        text = m.group(2).strip()
        checked = False
        c = _CHECKBOX.match(text)
        if c:
            checked, text = c.group(1) in ('x', 'X'), c.group(2).strip()
        cont, nested_raw = [], []
        j = i + 1
        while j < len(rows) and rows[j].strip():
            row = rows[j]
            nb = _BULLET.match(row)
            if nb and len(nb.group(1).expandtabs(2)) <= base:
                break
            if not nb and len(row) - len(row.lstrip()) <= base:
                break
            (nested_raw if nb else cont).append(row)
            j += 1
        heads.append((checked, text, cont, nested_raw, (i, j)))
        i = j

    resolved = []  # ActionEntry, or ('pending', checked, owner, due)
    for checked, text, cont, nested_raw, span in heads:
        head_rest, head_due = _split_due(text)
        owner, strength = _owner_of(head_rest)
        has_children = bool(cont or nested_raw)
        owner_only = owner is not None and (
            strength == 'strong' or (has_children and (strength == 'weak' or bool(head_due)))
        )
        if owner_only and has_children:
            parts = [part.strip() for part in cont] + [_plain(raw) for raw in nested_raw]
            task, due = _split_due(' '.join(p for p in parts if p))
            if task:
                resolved.append(ActionEntry(checked, _assemble(owner or '', task, head_due or due), merged=True, spans=[span]))
                continue
        if owner_only:
            resolved.append(('pending', checked, owner, head_due, span))
            continue
        entry_text = text
        merged = False
        if cont:
            body, due = _split_due(' '.join([text] + [part.strip() for part in cont]))
            entry_text = f'{body} (due {due})' if due else body
            merged = True
        resolved.append(ActionEntry(
            checked, entry_text, nested=[_plain(raw) for raw in nested_raw], nested_raw=list(nested_raw), merged=merged,
            spans=[span],
        ))

    entries, dropped, dropped_spans = [], 0, []
    for index, item in enumerate(resolved):
        if isinstance(item, ActionEntry):
            entries.append(item)
            continue
        _, checked, owner, due, span = item
        following = resolved[index + 1] if index + 1 < len(resolved) else None
        if isinstance(following, ActionEntry) and not following.merged and not _OWN_OWNER.match(following.text):
            body, own_due = _split_due(following.text)
            following.text = _assemble(owner or '', body, own_due or due)
            following.checked = following.checked or checked
            following.merged = True
            following.spans.insert(0, span)
            continue
        dropped += 1
        dropped_spans.append(span)
    return entries, dropped, dropped_spans


# --- deadlines -------------------------------------------------------------
#
# The model does not calculate: it writes a deadline as spoken ("(due vrijdag)") and the code below turns the
# known forms into YYYY-MM-DD against the conversation date. Unknown or vague wording stays as text in the task.
# A date the model computed itself only stays when the transcript supports it.

_WEEKDAY_INDEX = {
    'maandag': 0, 'dinsdag': 1, 'woensdag': 2, 'donderdag': 3, 'vrijdag': 4, 'zaterdag': 5, 'zondag': 6,
    'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3, 'friday': 4, 'saturday': 5, 'sunday': 6,
}
_MONTH_INDEX = {
    'januari': 1, 'jan': 1, 'january': 1, 'februari': 2, 'feb': 2, 'february': 2,
    'maart': 3, 'mrt': 3, 'mar': 3, 'march': 3, 'april': 4, 'apr': 4, 'mei': 5, 'may': 5,
    'juni': 6, 'jun': 6, 'june': 6, 'juli': 7, 'jul': 7, 'july': 7, 'augustus': 8, 'aug': 8, 'august': 8,
    'september': 9, 'sep': 9, 'sept': 9, 'oktober': 10, 'okt': 10, 'oct': 10, 'october': 10,
    'november': 11, 'nov': 11, 'december': 12, 'dec': 12,
}
_WD = '(?:' + '|'.join(sorted(_WEEKDAY_INDEX, key=len, reverse=True)) + ')'
_MO = '(?:' + '|'.join(sorted(_MONTH_INDEX, key=len, reverse=True)) + ')'
_ABS_ISO = re.compile(r'(?<![\d-])(\d{4})-(\d{1,2})-(\d{1,2})(?![\d])')
_ABS_NUM = re.compile(r'(?<![\d./-])(\d{1,2})([-/.])(\d{1,2})(?:\2(\d{4}|\d{2}))?(?![\d]|[-/]\d)')
_ABS_DMY = re.compile(
    r'(?<![\w.])(\d{1,2})(?:st|nd|rd|th|e|ste|de)?\s+(?:of\s+)?(' + _MO + r')\b\.?(?:,?\s+(\d{4})\b)?', re.IGNORECASE)
_ABS_MDY = re.compile(
    r'(?<![\w.])(' + _MO + r')\b\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4})\b)?', re.IGNORECASE)
_RELATIVE = re.compile(
    r'(?<![\w-])(?:'
    r'(?:volgende|next)\s+week(?:\s+(?:op|on))?\s+' + _WD +
    r'|' + _WD + r'\s+(?:volgende|next)\s+week'
    r'|(?:eind|einde)\s+van\s+(?:de|deze|het)\s+(?:maand|week|dag)'
    r'|end\s+of\s+(?:the\s+|this\s+)?(?:month|week|day)'
    r'|day\s+after\s+tomorrow|overmorgen|morgen|tomorrow|vandaag|vanavond|today|tonight|eod'
    r'|' + _WD +
    r')(?![\w-])',
    re.IGNORECASE,
)
_LEADING_FILLER = re.compile(
    r'^(?:(?:uiterlijk|op|by|on|tegen|at the latest)\s+|(?:komende|aanstaande|coming|this|deze)\s+(?=' + _WD + r'\b))+',
    re.IGNORECASE,
)


def _make_date(year: int, month: int, day: int) -> Optional[date]:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _next_occurrence(month: int, day: int, reference: date) -> Optional[date]:
    """First month/day on or after the reference date (year left out in speech)."""
    for year in range(reference.year, reference.year + 5):
        candidate = _make_date(year, month, day)
        if candidate is not None and candidate >= reference:
            return candidate
    return None


def _year(text: Optional[str]) -> Optional[int]:
    if not text:
        return None
    value = int(text)
    return value + 2000 if value < 100 else value


def _absolute_parts(match, kind: str) -> tuple:
    """(year or None, month, day) of an absolute-date match."""
    if kind == 'iso':
        return int(match.group(1)), int(match.group(2)), int(match.group(3))
    if kind == 'num':
        return _year(match.group(4)), int(match.group(3)), int(match.group(1))
    if kind == 'dmy':
        return _year(match.group(3)), _MONTH_INDEX[match.group(2).lower()], int(match.group(1))
    return _year(match.group(3)), _MONTH_INDEX[match.group(1).lower()], int(match.group(2))


_ABSOLUTE_FORMS = (('iso', _ABS_ISO), ('num', _ABS_NUM), ('dmy', _ABS_DMY), ('mdy', _ABS_MDY))


def _absolute_mentions(text: str) -> list:
    out = []
    for kind, pattern in _ABSOLUTE_FORMS:
        for match in pattern.finditer(text or ''):
            if kind == 'num' and match.group(2) == '.' and not match.group(4):
                continue  # "3.5" is a number, not a date
            out.append(_absolute_parts(match, kind))
    return out


def _week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def resolve_deadline(phrase, reference: Optional[date] = None) -> Optional[str]:
    """YYYY-MM-DD for a deadline as spoken, or None when the form is unknown, vague or needs a conversation date
    that is missing. Never guesses: "na de release", "soon", "next Friday" stay unknown."""
    if isinstance(reference, str):
        try:
            reference = date.fromisoformat(reference)
        except ValueError:
            reference = None
    s = re.sub(r'\s+', ' ', str(phrase or '').strip().strip('()[]{}.,;:!?')).strip().lower()
    if not s:
        return None
    for kind, pattern in _ABSOLUTE_FORMS:
        match = pattern.fullmatch(s)
        if not match or (kind == 'num' and match.group(2) == '.' and not match.group(4)):
            continue
        year, month, day = _absolute_parts(match, kind)
        if year is not None:
            found = _make_date(year, month, day)
        else:
            found = _next_occurrence(month, day, reference) if reference else None
        return found.isoformat() if found else None
    if reference is None:
        return None
    s = _LEADING_FILLER.sub('', s).strip()
    if s in ('vandaag', 'vanavond', 'today', 'tonight', 'eod', 'end of day', 'end of the day', 'eind van de dag', 'einde van de dag'):
        return reference.isoformat()
    if s in ('morgen', 'tomorrow'):
        return (reference + timedelta(days=1)).isoformat()
    if s in ('overmorgen', 'day after tomorrow'):
        return (reference + timedelta(days=2)).isoformat()
    match = re.fullmatch(r'(?:eind|einde)\s+van\s+(?:de|deze|het)\s+(maand|week)|end\s+of\s+(?:the\s+|this\s+)?(month|week)', s)
    if match:
        period = match.group(1) or match.group(2)
        if period in ('maand', 'month'):
            last = calendar.monthrange(reference.year, reference.month)[1]
            return date(reference.year, reference.month, last).isoformat()
        # The end of the work week is Friday; from Friday on, the Friday of the next week.
        friday = _week_start(reference) + timedelta(days=4)
        return (friday if reference < friday else friday + timedelta(days=7)).isoformat()
    match = re.fullmatch(r'(?:(?:volgende|next)\s+week(?:\s+(?:op|on))?\s+(' + _WD + r')|(' + _WD + r')\s+(?:volgende|next)\s+week)', s)
    if match:
        weekday = _WEEKDAY_INDEX[match.group(1) or match.group(2)]
        return (_week_start(reference) + timedelta(days=7 + weekday)).isoformat()
    if s in _WEEKDAY_INDEX:
        ahead = (_WEEKDAY_INDEX[s] - reference.weekday()) % 7 or 7  # the same weekday means next week
        return (reference + timedelta(days=ahead)).isoformat()
    return None


def _deadline_phrases(text: str) -> list:
    phrases = [m.group(0) for m in _RELATIVE.finditer(text or '')]
    for kind, pattern in _ABSOLUTE_FORMS:
        for match in pattern.finditer(text or ''):
            if kind == 'num' and match.group(2) == '.' and not match.group(4):
                continue
            phrases.append(match.group(0))
    return phrases


_DEADLINE_LANGUAGE = re.compile(
    r'\b(?:deadline|uiterlijk|vanavond|tonight|eod)\b'
    r'|\b(?:volgende|komende|deze|next|this|coming)\s+(?:de\s+|het\s+|the\s+)?(?:week|maand|month|dag|day|jaar|year|kwartaal|quarter|weekend|sprint|release)\b'
    r'|\b(?:over|binnen|in|within)\s+(?:\d+|een|twee|drie|vier|vijf|zes|a|one|two|three|four|five|six)\s+'
    r'(?:dagen|dag|weken|week|maanden|maand|days?|weeks?|months?)\b',
    re.IGNORECASE,
)


def has_deadline_language(transcript: str) -> bool:
    text = transcript or ''
    return bool(_DEADLINE_LANGUAGE.search(text) or _deadline_phrases(text))


_WORD = re.compile(r'\w+', re.UNICODE)


def _content_words(text: str) -> set:
    return {w for w in _WORD.findall((text or '').lower()) if len(w) >= 4}


def _supporting_lines(task: str, transcript: str) -> list:
    """Transcript lines about this task: the whole text when it is a single line, else lines sharing two words."""
    lines = [line for line in (transcript or '').splitlines() if line.strip()]
    if len(lines) <= 1:
        return lines
    words = _content_words(task)
    need = min(2, len(words))
    return [line for line in lines if need and len(words & _content_words(line)) >= need]


def _date_supported(iso: str, task: str, transcript: str, reference: Optional[date]) -> bool:
    """A date the model wrote stays only when the transcript gives it: the date itself in a recognisable form, or a
    deadline word in this item or in a transcript line about it that converts to exactly that date."""
    target = date.fromisoformat(iso)
    for year, month, day in _absolute_mentions(transcript):
        if (month, day) != (target.month, target.day):
            continue
        if year is not None:
            if year == target.year:
                return True
        elif reference is None or _next_occurrence(month, day, reference) == target:
            return True
    for text in [task, *_supporting_lines(task, transcript)]:
        if any(resolve_deadline(p, reference) == iso for p in _deadline_phrases(text)):
            return True
    return False


def _reference_date(meeting_date) -> Optional[date]:
    if not meeting_date:
        return None
    try:
        return date.fromisoformat(str(meeting_date))
    except ValueError:
        return None


def _append_words(body: str, words: str) -> str:
    words = words.strip()
    if not words or words.lower() in body.lower():
        return body
    return f'{body} {words}'.strip()


_ISO_ONLY = re.compile(r'\d{4}-\d{1,2}-\d{1,2}')


def strip_unsupported_due_dates(items: Iterable[str], transcript: Optional[str], meeting_date: Optional[str]) -> tuple:
    """Make the ``(due ...)`` of every item deterministic. Returns the items and how many dates were removed.

    - Words as spoken ("vrijdag", "volgende week dinsdag", "15 november", "eind van de maand") become
      ``(due YYYY-MM-DD)`` against the conversation date. Without that date only absolute dates convert.
    - Unknown or vague wording ("na de release") moves into the task text; no date is guessed.
    - A date the model wrote itself stays only when the transcript gives it (see ``_date_supported``);
      otherwise it is removed and counted. Without a transcript nothing can be checked and ISO dates stay.
    - Words that would become a date are dropped when the transcript has no deadline language at all."""
    reference = _reference_date(meeting_date)
    language = None if transcript is None else has_deadline_language(transcript)
    out, removed = [], 0
    for item in items:
        if not _DUE.search(item):
            out.append(item)
            continue
        body, due = _split_due(item)
        if due is None:
            out.append(body)
            continue
        due = due.strip(' .')
        resolved = resolve_deadline(due, reference)
        if _ISO_ONLY.fullmatch(due):
            ok = resolved is not None and (transcript is None or _date_supported(resolved, body, transcript, reference))
            if ok:
                out.append(f'{body} (due {resolved})')
            else:
                out.append(body)
                removed += 1
        elif resolved is not None:
            if language is False:
                out.append(body)
                removed += 1
            else:
                out.append(f'{body} (due {resolved})')
        else:
            out.append(_append_words(body, due))
    return out, removed


_OWNER_HEAD = re.compile(r'^([^:\n(]{1,40}):\s+(\S.*)$', re.DOTALL)


def _owner_like(name: str) -> bool:
    words = name.split()
    if not words or len(words) > 3:
        return False
    if _SPEAKER_LABEL.match(name) or name.lower() in _GROUPS:
        return True
    return words[0][0].isupper() and all(w[0].isupper() or w.lower() in _PARTICLES for w in words)


def _owner_in_transcript(name: str, transcript: str) -> bool:
    label = re.match(r'^(?:speaker|spreker)s?[ _]?(\d+)$', name, re.IGNORECASE)
    if label:
        return bool(re.search(r'(?:speaker|spreker)s?[ _]?' + label.group(1) + r'(?!\d)', transcript, re.IGNORECASE))
    words = [w for w in name.split() if w.lower() not in _PARTICLES] or name.split()
    # A given name or a surname is enough: the transcript names the person.
    for word in {words[0], words[-1]}:
        if re.search(r'(?<!\w)' + re.escape(word) + r'(?!\w)', transcript, re.IGNORECASE):
            return True
    return False


def drop_unsupported_owners(items: Iterable[str], transcript: Optional[str]) -> tuple:
    """Keep ``Name: task`` only when that name or speaker label occurs in the transcript (as a speaker or as
    mentioned); otherwise the owner is left out and the task stays. A prefix that is not shaped like a name
    ("Voorbereiden demo: ...") is part of the task and untouched. Returns the items and how many owners were dropped."""
    if transcript is None:
        return list(items), 0
    out, removed = [], 0
    for item in items:
        match = _OWNER_HEAD.match(item)
        if match and _owner_like(match.group(1).strip()) and not _owner_in_transcript(match.group(1).strip(), transcript):
            out.append(match.group(2))
            removed += 1
        else:
            out.append(item)
    return out, removed
