import { useLayoutEffect } from 'react';
import { useVenetaProfile } from '@/hooks/useProductSettings';

/** Presentation only. Electron identity, storage roots, theme and locale remain independent. */
export function ProductProfileEffects() {
  const veneta = useVenetaProfile();
  useLayoutEffect(() => {
    if (veneta) document.documentElement.dataset.product = 'veneta-memoai';
    else delete document.documentElement.dataset.product;
  }, [veneta]);
  return null;
}
