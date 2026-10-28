// Text formatting commands shared by the menu bar and the editor keymap.

import { EditorSelection } from '@codemirror/state';
import { undo, redo, selectLine } from '@codemirror/commands';

/**
 * Length of the block markers that open a line: indent, quote marks, list
 * marker, task box, heading hashes.
 */
function markerPrefixLength(text) {
  const match = /^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|\d+[.)])[ \t]+)?(?:\[[ xX]\][ \t]*)?(?:#{1,6}[ \t]+)?/.exec(text);
  return match ? match[0].length : 0;
}

/**
 * Narrows a range to the text actually worth emphasising.
 *
 * Selecting a whole line picks up its list marker and task box, and
 * `**- [ ] text**` is not bold. GFM also refuses to open emphasis directly
 * before a space, so a selection with slack at either end produces
 * `** text **`, which renders as literal asterisks.
 */
function contentRange(state, range) {
  // An empty caret is a position the user chose; trimming would teleport it
  // past the line's marker before inserting the pair of markers.
  if (range.empty) return { from: range.from, to: range.to };

  const line = state.doc.lineAt(range.from);
  let from = Math.max(range.from, line.from + markerPrefixLength(line.text));
  let to = Math.max(from, range.to);

  const text = state.sliceDoc(from, to);
  from += text.length - text.trimStart().length;
  to -= text.length - text.trimEnd().length;

  return to >= from ? { from, to } : { from: range.from, to: range.from };
}

/**
 * Wraps each selected range in `before`/`after`, or unwraps it when the
 * markers are already there, so the same shortcut toggles.
 */
function wrap(before, after = before) {
  return (target) => {
    target.dispatch(
      target.state.changeByRange((range) => {
        // Trimmed first: emphasis must not swallow a list marker, a task box
        // or stray whitespace, none of which markdown will render as bold.
        const { from, to } = contentRange(target.state, range);

        const text = target.state.sliceDoc(from, to);
        const outerFrom = Math.max(0, from - before.length);
        const outerTo = Math.min(target.state.doc.length, to + after.length);
        const outer = target.state.sliceDoc(outerFrom, outerTo);

        // Markers inside the selection: strip them.
        if (
          text.length >= before.length + after.length &&
          text.startsWith(before) &&
          text.endsWith(after)
        ) {
          const inner = text.slice(before.length, text.length - after.length);
          return {
            changes: { from, to, insert: inner },
            range: EditorSelection.range(from, from + inner.length),
          };
        }

        // Markers just outside the selection: strip those instead, so
        // re-pressing the shortcut undoes the previous press exactly.
        if (outer === before + text + after) {
          return {
            changes: { from: outerFrom, to: outerTo, insert: text },
            range: EditorSelection.range(outerFrom, outerFrom + text.length),
          };
        }

        return {
          changes: { from, to, insert: before + text + after },
          range: EditorSelection.range(from + before.length, from + before.length + text.length),
        };
      })
    );
    target.focus();
    return true;
  };
}

/** Inserts `[text](url)` and leaves the URL placeholder selected. */
function insertLink(target) {
  const { from, to } = contentRange(target.state, target.state.selection.main);
  const text = target.state.sliceDoc(from, to);
  const inserted = '[' + text + '](url)';
  const urlStart = from + text.length + 3;

  target.dispatch({
    changes: { from, to, insert: inserted },
    selection: EditorSelection.single(urlStart, urlStart + 3),
  });
  target.focus();
  return true;
}

/** Adds, removes or toggles the task box on every line the selection covers. */
function toggleTaskLines(target) {
  const { state } = target;
  const changes = [];

  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;

    for (let n = first; n <= last; n += 1) {
      const line = state.doc.line(n);
      const task = /^(\s*(?:[-*+]|\d+[.)])\s+)(\[[ xX]\]\s?)/.exec(line.text);
      const list = /^(\s*)((?:[-*+]|\d+[.)])\s+)/.exec(line.text);

      if (task) {
        // Already a task: flip it.
        const boxAt = line.from + task[1].length;
        const checked = task[2][1] !== ' ';
        changes.push({ from: boxAt, to: boxAt + 3, insert: checked ? '[ ]' : '[x]' });
      } else if (list) {
        // Plain list item: give it a box.
        const at = line.from + list[1].length + list[2].length;
        changes.push({ from: at, to: at, insert: '[ ] ' });
      } else if (line.text.trim()) {
        const indent = /^\s*/.exec(line.text)[0];
        changes.push({ from: line.from, to: line.from + indent.length, insert: indent + '- [ ] ' });
      }
    }
  }

  if (!changes.length) return false;
  target.dispatch({ changes });
  return true;
}

export const COMMANDS = {
  bold: wrap('**'),
  italic: wrap('*'),
  code: wrap('`'),
  strikethrough: wrap('~~'),
  link: insertLink,
  task: toggleTaskLines,
  selectLine,
  undo,
  redo,
};

