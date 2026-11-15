'use strict';

/**
 * The MemoAi notification toast (custom BrowserWindow, see the Notification class in main.js).
 *
 * 0.11.0: the toast sits at the normal window level. It is no longer always on top, no longer on every desktop
 * (Space) and no longer over full-screen apps; another window the user brings forward may cover it. What stays:
 * it is created hidden and shown with showInactive(), so it never takes focus and never brings the app forward;
 * it cannot take key focus (focusable: false); a click on its buttons counts at once (acceptFirstMouse); it closes
 * itself after 15 seconds. In headless E2E it is never shown at all (mayExposeWindow in e2e-window-visibility.js).
 */

const TOAST_AUTO_CLOSE_MS = 15000;
const TOAST_SIZE = Object.freeze({ width: 400, height: 70 });

/** BrowserWindow options of the toast, placed top right in the work area of the given display. */
function toastWindowOptions({ workArea, workAreaSize, preload }) {
  return {
    width: TOAST_SIZE.width,
    height: TOAST_SIZE.height,
    x: workArea.x + workAreaSize.width - 425,
    y: workArea.y + 1,
    // Created HIDDEN and only shown via showInactive() (showToast below). With the default show:true the
    // constructor shows it with the activating show(), which brings the whole app to the foreground.
    show: false,
    // The app stays in the background, so without this the first click on a button would only activate the app.
    acceptFirstMouse: true,
    frame: false,
    transparent: true,
    // Normal window level (0.11.0): not above every other window.
    alwaysOnTop: false,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload,
    },
  };
}

/**
 * Put a ready toast on screen: showInactive() only. No setAlwaysOnTop, no setVisibleOnAllWorkspaces (0.11.0).
 * Returns whether it was shown; headless E2E shows nothing.
 */
function showToast(win, { mayExpose }) {
  if (!mayExpose) return false;
  win.showInactive();
  return true;
}

module.exports = { TOAST_AUTO_CLOSE_MS, TOAST_SIZE, toastWindowOptions, showToast };
