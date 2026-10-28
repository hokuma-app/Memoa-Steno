import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { CommandPaletteProvider } from './CommandPalette';
import { TooltipProvider } from './ui/tooltip';
import { Sidebar } from './Sidebar';
import approvedIcon from '@/assets/veneta/veneta-memoai-icon.svg';

const brand = vi.hoisted(() => ({ enabled: true }));
vi.mock('@/lib/productBrand', () => ({
  get IS_VENETA_MEMOAI() { return brand.enabled; },
  get APP_NAME() { return brand.enabled ? 'Veneta MemoAi' : 'Steno'; },
}));

function sidebar(enabled: boolean, collapsed = false) {
  brand.enabled = enabled;
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  const element = document.createElement('div');
  element.innerHTML = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <CommandPaletteProvider>
        <TooltipProvider>
          <Sidebar collapsed={collapsed} onToggleCollapsed={() => {}} width={240}
            onWidthChange={() => {}} folders={[]} totalMeetings={0}
            onNewFolder={() => {}} currentRoute="/meetings" />
        </TooltipProvider>
      </CommandPaletteProvider>
    </QueryClientProvider>,
  );
  client.clear();
  return element;
}

describe('conditional sidebar brand', () => {
  it('shows the approved V tile and exact product name without a global privacy promise', () => {
    const element = sidebar(true);
    const lockup = element.querySelector('.veneta-sidebar-brand');
    expect(lockup?.textContent).toBe('Veneta MemoAi');
    expect(lockup?.querySelector('img')?.getAttribute('src')).toBe(approvedIcon);
    expect(lockup?.querySelector('img')?.width).toBe(46);
    expect(element.textContent).not.toMatch(/audio.*(local|device)|audio verlaat/i);
    expect(element.querySelector('.sb-row.active')?.textContent).toBe('All notes');
  });
  it('keeps the upstream brand and navigation unchanged when disabled', () => {
    const legacy = sidebar(false);
    expect(legacy.querySelector('.veneta-sidebar-brand')).toBeNull();
    expect(legacy.textContent).toContain('Steno');
    expect(legacy.querySelector('svg[viewBox="0 0 450 450"]')).not.toBeNull();
    expect(legacy.querySelector('nav')?.innerHTML).toBe(sidebar(true).querySelector('nav')?.innerHTML);
  });
  it('preserves collapse, width and resize affordances with either brand', () => {
    for (const enabled of [false, true]) {
      const collapsed = sidebar(enabled, true).querySelector<HTMLElement>('aside');
      expect(collapsed?.style.pointerEvents).toBe('none');
      expect(collapsed?.style.width).toBe('240px');
      expect(collapsed?.querySelector('.cursor-col-resize')).toBeNull();
      expect(sidebar(enabled).querySelector('.cursor-col-resize')).not.toBeNull();
    }
  });
});
