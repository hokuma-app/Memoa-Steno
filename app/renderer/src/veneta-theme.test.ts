import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const path = resolve('renderer/src/veneta-theme.css');
const css = existsSync(path) ? readFileSync(path, 'utf8') : '';
const root = postcss.parse(css);
const scope = "html[data-product='veneta-memoai']";
const tokens = (selector: string) => {
  const result: Record<string, string> = {};
  root.walkRules(selector, (rule) => {
    rule.walkDecls((decl) => { result[decl.prop] = decl.value + (decl.important ? ' !important' : ''); });
  });
  return result;
};

describe('Veneta MemoAi theme', () => {
  it('scopes every style rule and supplies light/dark semantic and Shadcn tokens', () => {
    expect(css.length).toBeGreaterThan(0);
    root.walkRules((rule) => { expect(rule.selector).toContain(scope); });
    const required = ['page', 'surface', 'surface-raised', 'surface-sunken', 'surface-hover', 'surface-active', 'surface-translucent', 'fg-1', 'fg-2', 'fg-muted', 'fg-inverse', 'border-subtle', 'border-strong', 'primary-hover', 'primary-fg', 'focus-ring', 'danger', 'danger-bg', 'success', 'success-bg', 'recording', 'shadow-sm', 'shadow-md', 'shadow-lg', 'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground', 'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted', 'muted-foreground', 'accent', 'accent-foreground', 'destructive', 'destructive-foreground', 'border', 'input', 'ring', 'accent-primary'];
    for (const selector of [scope, `${scope}.dark,\n${scope}[data-theme='dark']`]) {
      const values = tokens(selector);
      for (const name of required) expect(values[`--${name}`], `${selector}: ${name}`).toBeTruthy();
      expect(values['--primary']).toBe('51.06 100% 50%');
      expect(values['--primary-foreground']).toBe('0 0% 0%');
      expect(values['--primary-fg']).toBe('#000000');
    }
    expect(tokens(`${scope} .sb-row.active`)).toMatchObject({ background: 'var(--veneta-yellow)', color: '#000000' });
    expect(tokens(`${scope} .sb-row.active svg,\n${scope} .sb-row.active [style]`)).toMatchObject({ color: '#000000 !important' });
    expect(tokens(`${scope} :focus-visible`)['outline']).toBe('2px solid var(--focus-ring)');
  });

  it('keeps the legacy token-paired join action readable on yellow', () => {
    const action = tokens(`${scope} .upcoming-card button[style*='--primary-fg']`);
    expect(action.background).toBe('var(--veneta-yellow) !important');
    expect(action.color).toBe('#000000 !important');
  });

  it('bundles all approved font weights, license and original icon without remote requests', () => {
    // SHA-256 of the user-approved design assets, not network fixtures.
    const approved: Record<string, string> = {
      'titillium-web-400.ttf': 'c5722c5d8e6d69a520af1f0de180017a14209bd36cab538f2a340d30540c63dd',
      'titillium-web-600.ttf': '632915058d2b3163681dc88b8f0b6a2fbf518ec82beb3ca162ed59c20a6794df',
      'titillium-web-700.ttf': 'ae8eef687d0c98be76221bc2e9d19196e87e3fe86c3108f1995d405458c69848',
      'Titillium-Web-OFL.txt': 'c0562e066174197902a4a10606673d189f067970ef89c6013943b9cf182aadbc',
      'veneta-memoai-icon.svg': '8a02b9c034af9e4f4f580de555a716bc2c08fa9b1a27883452d4cb3dcb77882f',
    };
    const target = resolve('renderer/src/assets/veneta');
    for (const [file, hash] of Object.entries(approved)) {
      const actual = existsSync(resolve(target, file)) ? readFileSync(resolve(target, file)) : Buffer.alloc(0);
      expect(createHash('sha256').update(actual).digest('hex'), file).toBe(hash);
    }
    const weights: string[] = [];
    root.walkAtRules('font-face', (rule) => {
      const values: Record<string, string> = {};
      rule.walkDecls((decl) => { values[decl.prop] = decl.value; });
      expect(values['font-family']).toBe("'Titillium Web'");
      expect(values['font-display']).toBe('swap');
      expect(values.src).toContain(`./assets/veneta/titillium-web-${values['font-weight']}.ttf`);
      weights.push(values['font-weight']);
    });
    expect(weights.sort()).toEqual(['400', '600', '700']);
    expect(css).not.toMatch(/https?:|@import/);
  });
  it('opts into the approved yellow, charcoal and local Titillium typography', () => {
    const light = tokens(scope);
    expect(light['--veneta-yellow']).toBe('#FFD900');
    expect(light['--fg-1']).toBe('#333333');
    expect(light['--page']).toBe('#FAFAF7');
    expect(light['--surface-raised']).toBe('#FFFFFF');
    expect(light['--font-sans']).toContain("'Titillium Web'");
    expect(light['--font-serif']).toBe('var(--font-sans)');
    expect(light['--primary']).toBe('51.06 100% 50%');
    expect(light['--primary-foreground']).toBe('0 0% 0%');
  });
});
