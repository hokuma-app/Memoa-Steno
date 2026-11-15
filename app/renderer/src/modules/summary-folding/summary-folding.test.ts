import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const css = readFileSync('renderer/src/modules/summary-folding/summary-folding.css', 'utf8');
const reader = readFileSync('renderer/src/modules/summary-folding/textfold/reader.css', 'utf8');
const rule = (selector: string) => {
  const start = css.indexOf(selector + ' {');
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
};

it('pins the zoom bar to the bottom centre of the notes window above the dock and its fade', () => {
  const dock = rule('.summary-fold-dock');
  expect(dock).toMatch(/position:\s*fixed/);
  expect(dock).toMatch(/bottom:/);
  expect(Number(/z-index:\s*(\d+)/.exec(dock)?.[1])).toBeGreaterThan(40);
  expect(dock).toMatch(/pointer-events:\s*none/);
  expect(rule('.summary-fold-dock .zoombar')).toMatch(/pointer-events:\s*auto/);
  expect(rule('.summary-fold-spacer')).toMatch(/block-size:/);
});

it('keeps the TextFold zoom bar, stage and card rules (copied from reader.css) under the reader scope', () => {
  expect(reader).toMatch(/\.tf-root \.zoombar \{/);
  expect(reader).toMatch(/\.tf-root \.zthumb \{/);
  expect(reader).toMatch(/\.tf-root \.zstage\.on \{/);
  expect(reader).toMatch(/\.tf-root \.doc\[data-level="0"\] \.chunks \{[^}]*grid-template-columns:\s*repeat\(auto-fill/);
  expect(reader).not.toMatch(/(^|\n)(html|body|:root)\b/);
});

it('removes all motion for reduced motion, in the reader and its host', () => {
  const theme = readFileSync('renderer/src/modules/summary-folding/textfold/theme.css', 'utf8');
  expect(theme).toMatch(/prefers-reduced-motion: reduce[\s\S]*transition:\s*none/);
  const reduced = css.slice(css.search(/@media\s*\(prefers-reduced-motion:\s*reduce\)/));
  expect(reduced).toMatch(/transition:\s*none/);
});
