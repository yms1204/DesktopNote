// Messaging between the editor and the Swift host.

let suppressCount = 0;

/** Posts a message to Swift. No-ops when running outside the app (e.g. tests). */
export function post(action, data = {}) {
  const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bridge;
  if (!handler) return;
  try {
    handler.postMessage({ action, ...data });
  } catch (err) {
    console.error('bridge post failed', err);
  }
}

/**
 * Runs `fn` with change notifications suppressed.
 *
 * Programmatic document replacement (loading a note, restoring state) still
 * fires CodeMirror's update listener. Without this guard the editor would echo
 * that back to Swift as a user edit and overwrite the note it just loaded.
 * Re-entrant, because a load can trigger nested dispatches.
 */
export function withoutNotifying(fn) {
  suppressCount += 1;
  try {
    return fn();
  } finally {
    suppressCount -= 1;
  }
}

export function isSuppressed() {
  return suppressCount > 0;
}
