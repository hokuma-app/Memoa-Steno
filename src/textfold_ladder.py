"""Each unit's ladder: Full > Key (evidence sentences) > Brief (written) > Takeaway > Topic.

Derived from TextFold, textfold/ladder.py
Source: https://github.com/chenxiachan/textfold at commit 5062eacc0b1e2a2528e0906414f5073033051a30 (Apache-2.0)
Modified by Veneta MemoAi: CJK rules, apparatus handling, translations, links and the model call were left out;
unit parsing (paragraph, list item, heading) for a Markdown summary and the section line were added.
See app/renderer/src/modules/summary-folding/textfold/LICENSE and NOTICE.

Written words that also occur in the evidence sentences carry ``m``, the index of that source token, so the morph
slides the word instead of swapping it. A topic word carries ``k``, the takeaway token it slides from.
"""
import re

from .textfold_tokens import lcs_pairs, norm, tokenize_text

ROLES = ["context", "gap", "claim", "method", "setup", "result", "analysis", "limitation"]
BUDGET = {"takeaway": 14, "reason": 22, "topic": 3, "section": 16}


def clean(s):
    s = re.sub(r"\s+", " ", s or "").strip()
    s = re.sub(r"\s*——\s*", "，", s)
    s = re.sub(r"\s*[—–]\s*|\s+-\s+", ", ", s)
    return re.sub(r"[\s.;,!?:。；，！？：、]+$", "", s)

MARK = re.compile(r"⟦(a\d+)[^⟧]*⟧|\$([^$]+)\$")  # model text: only a marker for an atom of this unit is special


def written(text, u, atoms, ev, toks=None, sents=None):
    """A written line as tokens. A marker ⟦a12⟧ is that atom; $...$ that matches one of the unit's own formulas
    becomes that atom too (the formula then slides between levels), anything else is rendered with KaTeX."""
    toks, sents = (u["toks"], u["sents"]) if toks is None else (toks, sents)
    out = []
    key_atoms = [tk["a"] for s in ev if s < len(sents) for tk in toks[sents[s][0]:sents[s][1]] if "a" in tk]
    all_atoms = key_atoms + [tk["a"] for tk in toks if "a" in tk]
    squash = lambda x: re.sub(r"\s+", "", x)  # noqa: E731
    if not atoms:  # Model text cannot reference what the unit does not have; '$' and markers stay plain words.
        tokenize_text(text, None, out)
        return out
    pos = 0
    for m in MARK.finditer(text):
        if m.group(1):
            if m.group(1) not in atoms:
                continue  # A marker the unit does not have is left as written.
            tokenize_text(text[pos:m.start()], None, out)
            out.append({"a": m.group(1)})
        else:
            hit = next((a for a in all_atoms if atoms[a].get("kind") == "math" and squash(atoms[a].get("alt", "")) == squash(m.group(2))), None)
            if not hit:
                continue  # '$...$' that is no formula of this unit is ordinary text, never a model-made formula token.
            tokenize_text(text[pos:m.start()], None, out)
            out.append({"a": hit})
        pos = m.end()
    tokenize_text(text[pos:], None, out)
    return out

def locate(topic, take):
    """The topic as a run of the takeaway's tokens: indices, or [] when it is not in there verbatim."""
    squash = lambda tk: re.sub(r"\W", "", (tk.get("t") or "").lower())  # noqa: E731
    want = re.sub(r"\W", "", topic.lower())
    if not want:
        return []
    for i in range(len(take)):
        if not squash(take[i]) or not want.startswith(squash(take[i])):
            continue
        acc = ""
        for j in range(i, len(take)):
            acc += squash(take[j])
            if acc == want:
                return list(range(i, j + 1))
            if not want.startswith(acc):
                break
    return []

def is_word(tk):
    return "a" in tk or "x" in tk or bool(re.search(r"\w", tk.get("t", "")))

def head_words(toks, n):
    """Indices of the first n words (punctuation between them included, none at the end)."""
    idx, w = [], 0
    for i, tk in enumerate(toks):
        if is_word(tk) and w == n:
            break
        idx.append(i)
        w += is_word(tk)
    while idx and not is_word(toks[idx[-1]]):
        idx.pop()
    return idx

def assemble(u, o, atoms, model):
    ns = len(u["sents"])
    ev = sorted({int(x) for x in (o.get("evidence") or []) if isinstance(x, int) and 0 <= x < ns})[:3] or [0]
    take_text, reason_text = clean(o.get("takeaway")), clean(o.get("reason"))
    if not take_text:
        return local(u, atoms)
    take = written(take_text, u, atoms, ev)
    dot = "."
    brief = [dict(tk) for tk in take]
    if reason_text:
        brief.append({"t": dot, "s": 1})
        brief += written(reason_text, u, atoms, ev)
    brief.append({"t": dot})
    if take:
        take[-1].pop("s", None)
    tn = len(take)
    align(u, brief, ev, atoms)
    topic = topic_tokens(clean(o.get("topic")), brief, tn, u, atoms, ev, BUDGET["topic"])
    return {"role": o.get("role") if o.get("role") in ROLES else "context", "ev": ev, "brief": brief, "tn": tn,
            "topic": topic, "model": model}


def align(u, brief, ev, atoms, toks=None, sents=None):
    toks, sents = (u["toks"], u["sents"]) if toks is None else (toks, sents)
    key = [i for s in ev if s < len(sents) for i in range(*sents[s])]
    for bi, kj in lcs_pairs([norm(tk, atoms) for tk in brief], [norm(toks[i], atoms) for i in key]):
        brief[bi]["m"] = key[kj]

def topic_tokens(text, brief, tn, u, atoms, ev, budget=None, toks=None, sents=None):
    """Topic tokens; `k` is the takeaway token a topic word slides from. A phrase the model wrote that is not in the
    takeaway verbatim is kept when short (ThoughtDAG does the same): it read better than a cut of the takeaway's head."""
    budget = budget or BUDGET["topic"]
    loc = locate(text, brief[:tn])
    if loc:
        return [{**{x: brief[i][x] for x in ("t", "a", "x", "s", "f") if x in brief[i]}, "k": i} for i in loc]
    if text and sum(map(is_word, tokenize_text(text))) <= budget + 2:
        own = written(text, u, atoms, ev, toks, sents)
        for ti, bi in lcs_pairs([norm(tk, atoms) for tk in own], [norm(tk, atoms) for tk in brief[:tn]]):
            own[ti]["k"] = bi
        if own:
            own[-1].pop("s", None)
        return own
    return [{**{x: brief[i][x] for x in ("t", "a", "x", "s", "f") if x in brief[i]}, "k": i} for i in head_words(brief[:tn], budget)]

def local(u, atoms):
    """No model reply: the first sentence stands in for brief, its head for the shorter levels."""
    s, e = u["sents"][0]
    brief = [dict(tk, m=s + k) for k, tk in enumerate(u["toks"][s:e])]
    head = head_words(brief, BUDGET["takeaway"])
    tn = (head[-1] + 1) if head else len(brief)
    topic = [{**{x: brief[i][x] for x in ("t", "a", "x", "s", "f") if x in brief[i]}, "k": i} for i in head_words(brief[:tn], 3)]
    return {"role": "context", "ev": [0], "brief": brief, "tn": tn, "topic": topic, "model": "local"}


def suppressed():
    """A ladder that renders nothing below Full (a heading)."""
    return {"role": "context", "ev": [], "brief": [], "tn": 0, "topic": [], "model": "local"}


_RULE = re.compile(r"(?:-{3,}|\*{3,}|_{3,})")
_HEADING = re.compile(r"(#{1,6})\s+(.*\S)")
_ITEM = re.compile(r"([-*+]|\d{1,3}[.)])\s+(.*\S)")
_INLINE = [(re.compile(r"!?\[([^\]]*)\]\([^)]*\)"), r"\1"), (re.compile(r"(\*\*|__)(.+?)\1"), r"\2"),
           (re.compile(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])"), r"\1"), (re.compile(r"`([^`]*)`"), r"\1")]


def plain_inline(text):
    """Inline Markdown markers removed; the words stay (Veneta MemoAi)."""
    for pattern, repl in _INLINE:
        text = pattern.sub(repl, text)
    return re.sub(r"\s+", " ", text).strip()


def parse_units(text):
    """One unit per line: a heading, a list item or a paragraph. ``src`` is the exact stripped source line."""
    out = []
    for raw in text.split("\n"):
        line = raw.strip()
        if not line or _RULE.fullmatch(line):
            continue
        heading, item = _HEADING.fullmatch(line), _ITEM.fullmatch(line)
        if heading:
            unit = {"kind": "heading", "full": plain_inline(heading.group(2))}
        elif item:
            unit = {"kind": "item", "marker": item.group(1), "full": plain_inline(item.group(2))}
        else:
            unit = {"kind": "paragraph", "full": plain_inline(line)}
        if unit["full"]:
            out.append(dict(unit, src=line))
    return out
