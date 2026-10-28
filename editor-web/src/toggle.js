// Notion-style toggle blocks, written as `> `.
//
// A toggle is a blockquote: its first line is the title, the remaining lines
// are the body that collapses. Keeping it a real blockquote means the file is
// still ordinary markdown -- other renderers simply show it as a quote rather
// than choking on a private syntax.
//
// Collapsing reuses CodeMirror's own fold state (`codeFolding`) instead of a
// bespoke StateField, so folded ranges survive edits, map through changes and
// interact correctly with selection and search.

import { WidgetType, Decoration, EditorView } from '@codemirror/view';
import { StateField } from '@codemirror/state';
import {
  codeFolding,
  foldService,
  foldEffect,
  unfoldEffect,
  foldedRanges,
  syntaxTree,
} from '@codemirror/language';

/**
 * True once a `>` line has committed to being a toggle.
 *
 * The parser reports a Blockquote the moment `>` is typed, because `>` alone
 * is a valid empty quote. Rendering on that would pop the arrow, the hint and
 * the bold title into place a keystroke early -- the same trap as `#`. The
 * space is what commits it, matching every other block shortcut.
 */
export function isToggleStart(state, lineStart) {
  return /^[ \t]*>[ \t]/.test(state.doc.lineAt(lineStart).text);
}

/**
 * The collapsible range for the toggle whose title starts at `lineStart`,
 * or null if this line does not start one, or has no body to hide.
 */
export function toggleRangeAt(state, lineStart) {
  const line = state.doc.lineAt(lineStart);
  if (!isToggleStart(state, line.from)) return null;

  let node = syntaxTree(state).resolveInner(line.from, 1);
  while (node && node.name !== 'Blockquote') node = node.parent;
  if (!node) return null;

  // Only the first line of the quote carries the toggle.
  if (state.doc.lineAt(node.from).from !== line.from) return null;

  const last = state.doc.lineAt(node.to);
  if (last.number === line.number) return null;   // single line: nothing to fold

  return { from: line.to, to: node.to };
}

/** True when this toggle is currently collapsed. */
export function isCollapsed(state, lineStart) {
  const range = toggleRangeAt(state, lineStart);
  if (!range) return false;

  let collapsed = false;
  foldedRanges(state).between(range.from, range.from, (from) => {
    if (from === range.from) collapsed = true;
  });
  return collapsed;
}

/** Collapses or expands the toggle whose title contains `pos`. */
export function toggleAt(view, pos) {
  if (pos == null || pos < 0) return false;

  const line = view.state.doc.lineAt(pos);
  const range = toggleRangeAt(view.state, line.from);
  if (!range) return false;

  const effect = isCollapsed(view.state, line.from)
    ? unfoldEffect.of(range)
    : foldEffect.of(range);

  view.dispatch({ effects: effect });
  return true;
}

// Drawn as a path rather than a text glyph: "\u25B6" and friends vary in size
// and baseline between fonts, and a solid shape is what reads as a toggle.
const ARROW_SVG =
  '<svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">' +
  '<path d="M3.2 1.6 L7.6 5 L3.2 8.4 Z" /></svg>';

/** The triangle drawn at the start of a toggle's title line. */
export class ToggleArrowWidget extends WidgetType {
  constructor(collapsed, foldable) {
    super();
    this.collapsed = collapsed;
    this.foldable = foldable;
  }

  eq(other) {
    return other.collapsed === this.collapsed && other.foldable === this.foldable;
  }

  toDOM(view) {
    const arrow = document.createElement('span');
    arrow.className = 'cm-toggle-arrow';
    if (this.collapsed) arrow.classList.add('cm-toggle-collapsed');
    if (!this.foldable) arrow.classList.add('cm-toggle-inert');
    arrow.innerHTML = ARROW_SVG;   // constant markup, no interpolation
    arrow.setAttribute('role', 'button');
    arrow.setAttribute('aria-label', this.collapsed ? 'Expand' : 'Collapse');
    arrow.setAttribute('aria-expanded', this.collapsed ? 'false' : 'true');

    // Same contract as the task checkbox: suppress the editor's own handling
    // so the click never lands as a caret placement inside hidden text.
    arrow.addEventListener('mousedown', (event) => event.preventDefault());
    arrow.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleAt(view, view.posAtDOM(arrow));
    });

    return arrow;
  }

  ignoreEvent() {
    return true;
  }
}

/**
 * The hint shown inside a toggle that has no body yet.
 *
 * A toggle with nothing under it is otherwise indistinguishable from a bold
 * line with a triangle beside it, which leaves no clue that it is a container
 * or how to fill it.
 */
export class EmptyToggleWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    const hint = document.createElement('div');
    hint.className = 'cm-toggle-hint';
    hint.textContent = '\ube44\uc5b4 \uc788\ub294 \ud1a0\uae00\uc785\ub2c8\ub2e4. Enter\ub97c \ub20c\ub7ec \ub0b4\uc6a9\uc744 \ucd94\uac00\ud558\uc138\uc694.';
    return hint;
  }

  ignoreEvent() {
    return true;
  }
}

/** Hint lines for every toggle that has no body yet. */
function buildHints(state) {
  const ranges = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'Blockquote') return;
      const first = state.doc.lineAt(node.from);
      if (!isToggleStart(state, first.from)) return;                   // still just `>`
      if (state.doc.lineAt(node.to).number !== first.number) return;   // has a body
      ranges.push(
        Decoration.widget({ widget: new EmptyToggleWidget(), block: true, side: 1 }).range(first.to)
      );
    },
  });
  return Decoration.set(ranges, true);
}

/**
 * The hint has to live in a StateField: CodeMirror rejects block decorations
 * that come from a ViewPlugin ("Block decorations may not be specified via
 * plugins"), and the hint needs a line of its own.
 */
const toggleHintField = StateField.define({
  create: buildHints,
  update(value, tr) {
    return tr.docChanged ? buildHints(tr.state) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Teaches CodeMirror's folding which range a toggle line collapses. */
const toggleFoldService = foldService.of((state, lineStart) => toggleRangeAt(state, lineStart));

export const toggleExtension = [
  toggleFoldService,
  toggleHintField,
  codeFolding({
    placeholderDOM(view, onclick) {
      const dots = document.createElement('span');
      dots.className = 'cm-toggle-placeholder';
      dots.textContent = '…';
      dots.title = 'Expand';
      dots.addEventListener('click', onclick);
      return dots;
    },
  }),
];
