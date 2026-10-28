import approvedIcon from '@/assets/veneta/veneta-memoai-icon.svg';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppIcon } from './app-icon';

const brand = vi.hoisted(() => ({ enabled: true }));
vi.mock('@/lib/productBrand', () => ({
  get IS_VENETA_MEMOAI() { return brand.enabled; },
  get APP_NAME() { return brand.enabled ? 'Veneta MemoAi' : 'Steno'; },
}));

beforeEach(() => { brand.enabled = true; });
describe('product AppIcon', () => {
  it('uses the approved black V on yellow asset, keeping size and class without recoloring', () => {
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(<AppIcon size={42} className="test-icon" color="red" />);
    const image = container.querySelector('img');
    expect(image?.alt).toBe('Veneta MemoAi');
    expect(image?.getAttribute('src')).toBe(approvedIcon);
    expect(image?.width).toBe(42);
    expect(image?.height).toBe(42);
    expect(image?.classList.contains('test-icon')).toBe(true);
    expect(image?.style.color).not.toBe('red');
  });
  it('preserves the original themed dragonfly when the product flag is off', () => {
    brand.enabled = false;
    const markup = renderToStaticMarkup(<AppIcon size={32} color="red" />);
    expect(markup).toContain('aria-label="Steno"');
    expect(markup).toContain('viewBox="0 0 450 450"');
    expect(markup).toContain('M209.447 166.845');
    expect(markup).toContain('color:red');
    expect(markup).not.toContain('veneta-memoai');
  });
});
