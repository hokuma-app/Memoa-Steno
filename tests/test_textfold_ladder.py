"""Token model and ladder port (TextFold ladder.py): deterministic, no model."""
import unittest

from src import textfold_ladder as ladder
from src.textfold_tokens import split_sentences, tokenize_text


def unit(text):
    toks = tokenize_text(text)
    return {'toks': toks, 'sents': split_sentences(toks)}


class LadderPortTests(unittest.TestCase):
    TEXT = 'Het team koos voor Ollama. Kosten blijven onder het budget van 1,2 miljoen. Risico blijft onzeker.'

    def test_local_ladder_uses_author_words_with_token_identity(self):
        u = unit(self.TEXT)
        lad = ladder.local(u, {})
        self.assertEqual(lad['model'], 'local')
        self.assertEqual(lad['ev'], [0])
        s, e = u['sents'][0]
        self.assertEqual([t['t'] for t in lad['brief']], [t['t'] for t in u['toks'][s:e]])
        self.assertEqual([t['m'] for t in lad['brief']], list(range(s, e)))
        self.assertTrue(0 < lad['tn'] <= len(lad['brief']))
        self.assertTrue(all('k' in t and 0 <= t['k'] < lad['tn'] for t in lad['topic']))
        self.assertLessEqual(len(lad['topic']), 3)

    def test_assemble_aligns_written_words_to_evidence_tokens(self):
        u = unit(self.TEXT)
        o = {'evidence': [1], 'takeaway': 'Kosten blijven onder budget', 'reason': 'Risico blijft onzeker', 'topic': 'Kosten'}
        lad = ladder.assemble(u, o, {}, 'ai')
        self.assertEqual(lad['ev'], [1])
        self.assertEqual(lad['tn'], 4)
        words = [t['t'] for t in lad['brief']]
        self.assertEqual(words[:4], ['Kosten', 'blijven', 'onder', 'budget'])
        m = {t['t']: t['m'] for t in lad['brief'] if 'm' in t}
        self.assertEqual(u['toks'][m['Kosten']]['t'], 'Kosten')
        s, e = u['sents'][1]
        self.assertTrue(all(s <= t['m'] < e for t in lad['brief'] if 'm' in t))
        self.assertEqual([t['t'] for t in lad['topic']], ['Kosten'])
        self.assertEqual(lad['topic'][0]['k'], 0)

    def test_evidence_is_clamped_to_three_valid_sentences(self):
        u = unit(self.TEXT)
        lad = ladder.assemble(u, {'evidence': [2, 9, 0, 1, 2], 'takeaway': 'Klaar', 'reason': '', 'topic': 'Klaar'}, {}, 'ai')
        self.assertEqual(lad['ev'], [0, 1, 2])

    def test_unit_parsing_distinguishes_paragraph_item_and_heading(self):
        units = ladder.parse_units('Intro tekst.\n\n## Kop\n- Een punt.\n2. Tweede punt.\n---\nSlot.')
        self.assertEqual([(x['kind'], x.get('marker'), x['full']) for x in units], [
            ('paragraph', None, 'Intro tekst.'), ('heading', None, 'Kop'),
            ('item', '-', 'Een punt.'), ('item', '2.', 'Tweede punt.'), ('paragraph', None, 'Slot.')])
        self.assertEqual(units[0]['src'], 'Intro tekst.')
        self.assertEqual(units[2]['src'], '- Een punt.')

    def test_inline_markdown_is_removed_but_words_stay(self):
        units = ladder.parse_units('Dit is **belangrijk** en [een link](https://x.nl) met `code`.')
        self.assertEqual(units[0]['full'], 'Dit is belangrijk en een link met code.')

    def test_dollar_signs_in_model_text_stay_plain_tokens(self):
        """Review 0.9.2 (a): a few '$' must never become a formula token that invalidates the whole document."""
        u = unit(self.TEXT)
        o = {'evidence': [1], 'takeaway': 'Kosten zijn $5 en $6 per maand', 'reason': 'Budget van $1 blijft', 'topic': 'Kosten'}
        for atoms in ({}, {'a1': {'kind': 'math', 'alt': 'x+y', 'html': 'x'}}):
            with self.subTest(atoms=bool(atoms)):
                lad = ladder.assemble(u, o, atoms, 'ai')
                self.assertFalse([t for t in lad['brief'] + lad['topic'] if 'x' in t])
                self.assertIn('$', [t['t'] for t in lad['brief'] if 't' in t])

    def test_marker_applies_only_when_the_unit_has_that_atom(self):
        u = unit(self.TEXT)
        atoms = {'a1': {'kind': 'math', 'alt': 'x+y', 'html': 'x'}}
        toks = ladder.written('Som \u27e6a1\u27e7 en \u27e6a9\u27e7', u, atoms, [1])
        self.assertEqual([t['a'] for t in toks if 'a' in t], ['a1'])


if __name__ == '__main__':
    unittest.main()
