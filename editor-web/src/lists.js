// Block structure commands: Tab/Shift-Tab nesting, ordered-list numbering, and
// Enter on an empty item.

import { ChangeSet, EditorSelection } from '@codemirror/state';

/** `^indent marker spacing` of a list item. */
const ITEM = /^([ \t]*)((?:[-*+]|\d+[.)]))([ \t]+)/;
const ORDERED = /^([ \t]*)(\d+)([.)])([ \t]+)/;

const indentWidth = (text) => text.replace(/\t/g, '  ').length;

/** Parses a line into its list-item parts, or null if it is not one. */
function itemAt(doc, lineNumber) {
  const line = doc.line(lineNumber);
  const match = ITEM.exec(line.text);
  if (!match) return null;
  return {
    line,
    indent: match[1],
    width: indentWidth(match[1]),
    // Column where the item's text begins -- the indent a child must adopt.
    contentColumn: indentWidth(match[1]) + match[2].length + match[3].length,
  };
}

const leadingWidth = (text) => indentWidth(/^[ \t]*/.exec(text)[0]);

/**
 * Finds the list item directly above `lineNumber` at exactly `width` indent.
 *
 * Indenting is only legal under a preceding sibling, which is also why Notion
 * refuses to indent the first item of a list.
 */
function siblingAbove(doc, lineNumber, width) {
  for (let n = lineNumber - 1; n >= 1; n -= 1) {
    const line = doc.line(n);
    if (!line.text.trim()) continue;

    const item = itemAt(doc, n);
    if (!item) {
      // Indented prose belongs to the list; anything else ends it.
      if (leadingWidth(line.text) <= width) return null;
      continue;
    }
    if (item.width === width) return item;
    if (item.width < width) return null;   // that is our parent, not a sibling
  }
  return null;
}

/** Finds the enclosing item one level out, for outdenting. */
function parentAbove(doc, lineNumber, width) {
  for (let n = lineNumber - 1; n >= 1; n -= 1) {
    const line = doc.line(n);
    if (!line.text.trim()) continue;
    const item = itemAt(doc, n);
    if (item && item.width < width) return item;
    if (!item && leadingWidth(line.text) <= width) return null;
  }
  return null;
}

/** Last line of the subtree rooted at `lineNumber` (its nested children). */
function subtreeEnd(doc, lineNumber, width) {
  let last = lineNumber;
  for (let n = lineNumber + 1; n <= doc.lines; n += 1) {
    const line = doc.line(n);
    if (!line.text.trim()) continue;
    if (leadingWidth(line.text) <= width) break;
    last = n;
  }
  return last;
}

/**
 * Re-labels ordered lists so the numbers shown always run 1, 2, 3 within each
 * level, taking the starting number from each list's first item.
 *
 * Counters are keyed by indent width; a deeper level pushes a new counter and
 * popping it resumes the outer list where it left off.
 */
export function renumberSpecs(doc) {
  const specs = [];
  const counters = [];
  let blankRun = 0;

  for (let n = 1; n <= doc.lines; n += 1) {
    const line = doc.line(n);

    if (!line.text.trim()) {
      blankRun += 1;
      if (blankRun >= 2) counters.length = 0;   // a blank gap ends every list
      continue;
    }
    blankRun = 0;

    const ordered = ORDERED.exec(line.text);
    if (!ordered) {
      const width = leadingWidth(line.text);
      if (ITEM.test(line.text)) {
        // A bullet at this level interrupts ordered numbering here and deeper.
        while (counters.length && counters[counters.length - 1].width >= width) counters.pop();
      } else if (width === 0) {
        counters.length = 0;                     // top-level prose ends all lists
      }
      continue;
    }

    const width = indentWidth(ordered[1]);
    while (counters.length && counters[counters.length - 1].width > width) counters.pop();

    let counter = counters[counters.length - 1];
    if (!counter || counter.width < width) {
      counter = { width, next: parseInt(ordered[2], 10) || 1, delim: ordered[3] };
      counters.push(counter);
    }

    const have = ordered[2] + ordered[3];
    const want = String(counter.next) + counter.delim;
    if (have !== want) {
      const from = line.from + ordered[1].length;
      specs.push({ from, to: from + have.length, insert: want });
    }
    counter.next += 1;
  }

  return specs;
}

/** Lines the selection covers, deduplicated. */
function selectedLines(state) {
  const numbers = new Set();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n += 1) numbers.add(n);
  }
  return [...numbers].sort((a, b) => a - b);
}

/**
 * Shifts each selected item, and everything nested under it, by one level.
 *
 * `resolve` returns the item's new indent string, or null to leave it alone.
 */
function reindent(view, resolve) {
  const { state } = view;
  const doc = state.doc;
  const specs = [];
  const handled = new Set();

  for (const lineNumber of selectedLines(state)) {
    if (handled.has(lineNumber)) continue;

    const item = itemAt(doc, lineNumber);
    if (!item) continue;

    const target = resolve(doc, lineNumber, item);
    if (target == null) continue;

    const delta = indentWidth(target) - item.width;
    if (delta === 0) continue;

    // Children move with their parent, so the subtree keeps its shape.
    const last = subtreeEnd(doc, lineNumber, item.width);
    for (let n = lineNumber; n <= last; n += 1) {
      handled.add(n);
      const line = doc.line(n);
      if (!line.text.trim()) continue;

      const existing = /^[ \t]*/.exec(line.text)[0];
      const width = Math.max(0, indentWidth(existing) + delta);
      specs.push({ from: line.from, to: line.from + existing.length, insert: ' '.repeat(width) });

      // An item pushed inward starts a fresh nested list, so its number resets
      // rather than carrying over from the level it came from. If it turns out
      // to be joining an existing nested list, renumbering below corrects it.
      const ordered = n === lineNumber && delta > 0 ? ORDERED.exec(line.text) : null;
      if (ordered) {
        const from = line.from + ordered[1].length;
        specs.push({ from, to: from + ordered[2].length, insert: '1' });
      }
    }
  }

  if (!specs.length) return false;

  // Indent and renumber land in one transaction so a single undo reverses the
  // whole operation, and so the numbering never flashes a stale value.
  const indentChanges = state.changes(specs);
  const shifted = indentChanges.apply(doc);
  const numbering = ChangeSet.of(renumberSpecs(shifted), shifted.length);

  const combined = indentChanges.compose(numbering);
  view.dispatch({
    changes: combined,
    // Mapped, not reused: outdenting shortens the line, so the original
    // offsets can fall past the end of the new document.
    selection: state.selection.map(combined),
    userEvent: 'input.indent',
    scrollIntoView: true,
  });
  return true;
}

/** Tab: nest the item under the sibling above it. */
export function indentListItem(view) {
  return reindent(view, (doc, lineNumber, item) => {
    const sibling = siblingAbove(doc, lineNumber, item.width);
    return sibling ? ' '.repeat(sibling.contentColumn) : null;
  });
}

/** Shift-Tab: lift the item out to its parent's level. */
export function outdentListItem(view) {
  return reindent(view, (doc, lineNumber, item) => {
    if (item.width === 0) return null;
    const parent = parentAbove(doc, lineNumber, item.width);
    return ' '.repeat(parent ? parent.width : 0);
  });
}

/** A list item or quote line holding nothing but its marker. */
const EMPTY_ITEM = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]*)?$/;
const EMPTY_QUOTE = /^([ \t]*)>[ \t]*$/;

/**
 * Enter on an empty item leaves the list instead of extending it.
 *
 * `insertNewlineContinueMarkup` does not do this: given `- [ ] ` it inserts a
 * blank line and carries the marker down, so pressing Enter to escape a list
 * appears to break the line twice and never actually escapes. Nested items
 * outdent one level first, the way Notion does, so repeated Enter walks out of
 * a nested list one level at a time.
 *
 * Returns false for anything else, letting the markdown command handle it.
 */
export function exitEmptyBlock(view) {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false;

  const line = state.doc.lineAt(range.head);
  const item = EMPTY_ITEM.exec(line.text);
  const match = item || EMPTY_QUOTE.exec(line.text);
  if (!match) return false;

  // Nested: step out one level and keep the marker.
  if (item && match[1].length > 0) return outdentListItem(view);

  // Outermost: drop the marker and carry on as a plain paragraph on this line.
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: '' },
    selection: EditorSelection.single(line.from),
    userEvent: 'input',
    scrollIntoView: true,
  });
  return true;
}

/** Indent plus a quote run, or a list marker with an optional task box. */
export const MARKER_PREFIX = /^[ \t]*(?:(?:>[ \t]*)+|(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]*)?)/;

/**
 * Backspace at the start of an item's text removes the whole marker.
 *
 * `deleteMarkupBackward` instead replaces the marker with enough spaces to
 * hold the text in the same column, so deleting a nested `  - [ ] ` leaves
 * eight spaces behind. The text looks detached, and in markdown that much
 * indentation reads as a continuation or a code block rather than a paragraph.
 *
 * Removing the indent too is what makes the line an ordinary paragraph, and it
 * matches what already happens at the outermost level.
 */
export function deleteMarkerBackward(view) {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false;

  const line = state.doc.lineAt(range.head);
  const match = MARKER_PREFIX.exec(line.text);
  if (!match) return false;

  // Only when the caret sits exactly where the text begins.
  const prefixEnd = line.from + match[0].length;
  if (range.head !== prefixEnd) return false;

  view.dispatch({
    changes: { from: line.from, to: prefixEnd, insert: '' },
    selection: EditorSelection.single(line.from),
    userEvent: 'delete.backward',
  });
  return true;
}

/**
 * The sibling block immediately before `first`, or null if there is none at
 * this level.
 *
 * A shallower line above is our parent, not a sibling -- moving past it would
 * silently change the nesting, so that case refuses and the user outdents
 * first.
 */
function siblingBlockAbove(doc, first, width) {
  for (let n = first - 1; n >= 1; n -= 1) {
    if (!doc.line(n).text.trim()) continue;
    const item = itemAt(doc, n);
    if (!item) return width === 0 ? n : null;   // plain prose ends the list
    if (item.width === width) return n;
    if (item.width < width) return null;        // our parent
  }
  return null;
}

/**
 * Moves the current item, together with everything nested under it, past its
 * neighbouring sibling.
 *
 * `moveLineUp`/`moveLineDown` shift a single line, which walks a parent out
 * from under its own children and quietly breaks the outline.
 */
function moveBlock(view, direction) {
  const { state } = view;
  const doc = state.doc;
  const range = state.selection.main;

  const first = doc.lineAt(range.from).number;
  const item = itemAt(doc, first);
  const last = item
    ? subtreeEnd(doc, first, item.width)
    : doc.lineAt(range.to).number;
  const width = item ? item.width : 0;

  let aFirst;
  let aLast;
  let bFirst;
  let bLast;
  let movingIsSecond;

  if (direction < 0) {
    const above = siblingBlockAbove(doc, first, width);
    if (above == null) return false;
    const aboveItem = itemAt(doc, above);
    aFirst = above;
    aLast = aboveItem ? subtreeEnd(doc, above, aboveItem.width) : above;
    bFirst = first;
    bLast = last;
    movingIsSecond = true;
  } else {
    if (last >= doc.lines) return false;
    let next = last + 1;
    while (next <= doc.lines && !doc.line(next).text.trim()) next += 1;
    if (next > doc.lines) return false;

    const nextItem = itemAt(doc, next);
    if (item && (!nextItem || nextItem.width !== width)) return false;
    if (!item && nextItem) return false;

    aFirst = first;
    aLast = last;
    bFirst = next;
    bLast = nextItem ? subtreeEnd(doc, next, nextItem.width) : next;
    movingIsSecond = false;
  }

  const aFrom = doc.line(aFirst).from;
  const aTo = doc.line(aLast).to;
  const bFrom = doc.line(bFirst).from;
  const bTo = doc.line(bLast).to;

  const aText = doc.sliceString(aFrom, aTo);
  const between = doc.sliceString(aTo, bFrom);
  const bText = doc.sliceString(bFrom, bTo);

  // Keep the caret on the text that moved.
  const offset = range.head - (movingIsSecond ? bFrom : aFrom);
  const landedAt = movingIsSecond ? aFrom : aFrom + bText.length + between.length;

  const swap = state.changes({ from: aFrom, to: bTo, insert: bText + between + aText });
  const shifted = swap.apply(doc);
  const numbering = ChangeSet.of(renumberSpecs(shifted), shifted.length);
  const combined = swap.compose(numbering);

  view.dispatch({
    changes: combined,
    // Mapping through the swap is unreliable because the whole span is
    // rewritten; the landing offset is computed directly instead.
    selection: EditorSelection.single(landedAt + offset),
    userEvent: 'move.line',
    scrollIntoView: true,
  });
  return true;
}

export const moveBlockUp = (view) => moveBlock(view, -1);
export const moveBlockDown = (view) => moveBlock(view, 1);

export const blockKeymap = [
  { key: 'Ctrl-Cmd-ArrowUp', run: moveBlockUp },
  { key: 'Ctrl-Cmd-ArrowDown', run: moveBlockDown },
  { key: 'Backspace', run: deleteMarkerBackward },
  { key: 'Enter', run: exitEmptyBlock },
  { key: 'Tab', run: indentListItem },
  { key: 'Shift-Tab', run: outdentListItem },
];
