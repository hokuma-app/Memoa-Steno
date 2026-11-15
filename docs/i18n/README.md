# Copy inventory

`copy-inventory.json` is a generated record of every English string the renderer shows.
It is checked in, and CI fails when it is stale (`npm run i18n:inventory` from `app/`).

Regenerate with:

```
cd app && npm run i18n:inventory:update
```

## Translation catalogue

All renderer copy lives in `app/renderer/src/i18n/locales/en.json` and is read through the typed `t()` helper from `@/i18n`.
Dynamic values use `{{name}}` placeholders and the second `t()` argument supplies their values.
Counts get whole sentences per form (`.one` / `.other`) instead of sentence fragments, so each language can phrase them.

The default build is English. The Veneta build (`IS_VENETA_MEMOAI`) reads `veneta-nl.json` on top of the English catalogue.
`app/renderer/src/i18n/veneta-nl.test.ts` fails when an English key has no Dutch value, when placeholders differ,
or when a Dutch value is still the English text outside a reviewed list (product names, units, URLs).

The main process has its own catalogue, `app/main-copy.js` (tray, menus, notifications, dialogs, updater and
the IPC errors the renderer shows as-is), checked by `app/main-copy.test.js`. Identifiers never go through a
catalogue: bundle ID, internal app name, data root, file names, log lines and error codes other code compares.
Python output that other code reads stays English; the renderer translates known reasons (for example the
Obsidian sync's waiting reasons in `VaultSyncStatusLine.tsx`).

Interface language, transcription language and summary language are three separate things. The summary
language is the `summary_language` setting (`src/config.py`); the Veneta build recommends Dutch through an
environment default that applies only while the user has not chosen one.

## Woordenlijst Nederlands (Veneta-build)

Gebruik deze termen overal hetzelfde. Je-vorm, gewone zinnen, geen em dashes.

| Engels | Nederlands |
| --- | --- |
| note / notes | notitie / notities |
| meeting | gesprek |
| recording / record | opname / opnemen |
| transcript | transcript (de transcriptie is het proces) |
| summary / summarise | samenvatting / samenvatten |
| summary detail, detail levels | samenvattingsdetail, detailniveaus |
| key points / key topics | belangrijkste punten / belangrijkste onderwerpen |
| action items | actiepunten |
| checklist | checklist |
| template / report | sjabloon / verslag |
| settings | instellingen |
| folder | map |
| speaker / voice profile | spreker / stemprofiel |
| vault (Obsidian) | kluis |
| menu bar | menubalk |
| Steno, StenoAI (as the product) | Veneta MemoAi |

Upstream names stay as they are where they name the real destination or a fixed identifier:
Steno Labs and StenoLabs (telemetry), Steno Enterprise, the Steno skill, the `StenoAI` vault folder.

Translation keys must be static string literals.
The inventory resolves those calls against the English catalogue and records the English value under the calling source file, so moving a literal behind `t()` does not rewrite or shrink the copy inventory.
Missing or dynamic keys fail the inventory check instead of silently dropping copy.

## What it is for

An i18n migration rewrites hundreds of hardcoded strings into `t()` lookups. That edit is
meant to be pure motion — same words, new home — and it is exactly where wording changes
by accident. One attempt in this repo turned `Nothing to process` into `Nothing was
recorded.` in passing; three e2e specs went red and nothing in the diff said why. Around
two thirds of this app's copy is asserted by no test at all, so the same slip elsewhere
would have landed unseen.

So the review rule for a migration is one sentence:

> **The inventory diff must show strings moving, never changing.**

Outside a migration it keeps working as a copy changelog: an intentional wording change
shows up as a one-file diff in the PR that makes it. It blocks nothing on its own — it
witnesses.

## Reading it

Each file has up to two arrays:

- **`copy`** — the contract. Strings reached through positions that render by
  construction (JSX text, JSX children expressions, copy-bearing attributes) or that read
  as prose. Treat a change here as a copy change until proven otherwise.
- **`uncertain`** — the recall safety net. Strings that survived the reject list but carry
  no positive signal of being copy: single lowercase words, event names, enum values. A PR
  that only moves `uncertain` lines is a quick read.

Repeated copy is recorded once per occurrence, deliberately. Collapsing duplicates hides
the case where a file holds a string twice and one occurrence is changed to another string
already present there — the inventory would be byte-identical while the UI changed.

## Why it over-collects

A string is recorded unless it is *provably* not copy. That direction is the point: this
file's failure mode must be visible clutter, not silent omission. An earlier version used
an allowlist of copy shapes and three review rounds each caught it dropping different real
copy (`All notes`, `AI`, `note`/`notes`, `Ask AI`, `Re-run first-time setup`), because
such a list has to enumerate every shape English can take.

Rules live in `app/scripts/i18n-copy-rules.mjs`; extraction in
`app/scripts/i18n-copy-inventory.mjs`; both are covered by `app/i18n-gate.test.mjs`. If you
find markup in here that should be rejected, tighten the reject list and regenerate — and
add a test, because every gap in this tooling so far has been a silent one.

See the "Interface copy and i18n" section of the repo's `CLAUDE.md` for how this pairs with
the lint gate.
