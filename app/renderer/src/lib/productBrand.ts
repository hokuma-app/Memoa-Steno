// Explicit product boundary; legacy builds keep their existing presentation.
export const IS_VENETA_MEMOAI = import.meta.env.VITE_VENETA_MEMOAI === '1';
export const APP_NAME = IS_VENETA_MEMOAI ? 'Veneta MemoAi' : 'Steno';
