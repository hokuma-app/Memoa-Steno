import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductProfileEffects } from './ProductProfileEffects';

const state = vi.hoisted(() => ({ veneta: true }));
vi.mock('@/hooks/useProductSettings', () => ({ useVenetaProfile: () => state.veneta }));
afterEach(() => { cleanup(); delete document.documentElement.dataset.product; });

describe('product presentation effects', () => {
  it('switches appearance only, without changing color mode or storage identity', () => {
    document.documentElement.dataset.theme = 'dark';
    const rendered = render(<ProductProfileEffects />);
    expect(document.documentElement.dataset.product).toBe('veneta-memoai');
    state.veneta = false;
    rendered.rerender(<ProductProfileEffects />);
    expect(document.documentElement.dataset.product).toBeUndefined();
    expect(document.documentElement.dataset.theme).toBe('dark');
    delete document.documentElement.dataset.theme;
    state.veneta = true;
  });
});
