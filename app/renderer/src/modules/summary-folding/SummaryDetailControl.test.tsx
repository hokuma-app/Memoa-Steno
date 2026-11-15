import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SummaryDetailControl } from './SummaryDetailControl';
afterEach(cleanup);

it('uses a labeled controlled native radio group with three Dutch choices and parent-supplied detailed default', () => {
  const onChange = vi.fn();
  const view = render(<SummaryDetailControl value="detailed" onChange={onChange} />);
  const group = screen.getByRole('group', { name: 'Lengte van nieuwe samenvattingen' });
  expect(group.getAttribute('aria-describedby')).toBeTruthy();
  expect(screen.getAllByRole('radio').map((item) => item.getAttribute('value'))).toEqual([
    'brief',
    'balanced',
    'detailed',
  ]);
  expect((screen.getByRole('radio', { name: 'Uitgebreid' }) as HTMLInputElement).checked).toBe(
    true
  );
  for (const [label, value] of [
    ['Kort', 'brief'],
    ['Gemiddeld', 'balanced'],
    ['Uitgebreid', 'detailed'],
  ]) {
    fireEvent.click(screen.getByRole('radio', { name: label }));
    if (value !== 'detailed') expect(onChange).toHaveBeenLastCalledWith(value);
  }
  view.rerender(<SummaryDetailControl value="balanced" onChange={onChange} />);
  expect((screen.getByRole('radio', { name: 'Gemiddeld' }) as HTMLInputElement).checked).toBe(true);
});

it('disables the full settings group without side effects', () => {
  const onChange = vi.fn();
  render(<SummaryDetailControl value="detailed" onChange={onChange} disabled />);
  const group = screen.getByRole('group') as HTMLFieldSetElement;
  expect(group.disabled).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: 'Kort' }));
  expect(onChange).not.toHaveBeenCalled();
});
