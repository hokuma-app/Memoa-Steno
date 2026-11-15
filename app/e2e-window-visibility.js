'use strict';

/**
 * The renderer must keep running during E2E tests, but the native window must
 * not interrupt whoever is using the host Mac. Keeping this decision pure
 * gives the main process one gate for every show/focus path.
 */
function mayExposeMainWindow({ isE2EHeadless = false } = {}) {
  return !isE2EHeadless;
}

/**
 * Any other on-screen surface (the notification toast, native open/save
 * dialogs, the dock icon): same rule as the main window. In headless E2E the
 * window may exist and be driven by Playwright, but it never reaches the screen.
 */
function mayExposeWindow({ isE2EHeadless = false } = {}) {
  return mayExposeMainWindow({ isE2EHeadless });
}

/**
 * macOS activation policy for this launch. Headless E2E runs as an accessory
 * app: no dock icon, and starting the app does not activate it over whatever
 * the user is working in. `null` leaves the normal (production) policy alone.
 */
function e2eActivationPolicy({ isE2EHeadless = false, platform = process.platform } = {}) {
  return isE2EHeadless && platform === 'darwin' ? 'accessory' : null;
}

module.exports = { mayExposeMainWindow, mayExposeWindow, e2eActivationPolicy };
