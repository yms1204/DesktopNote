import { WidgetType } from '@codemirror/view';
import katex from 'katex';

/**
 * Rewrites the task marker on the line containing `pos`.
 *
 * The range is re-derived from the document on every toggle instead of being
 * captured when the widget was built, so a checkbox stays correct even if edits
 * elsewhere shifted the line underneath it.
 */
export function toggleTaskAt(view, pos) {
  if (pos == null || pos < 0) return false;
  const line = view.state.doc.lineAt(pos);
  const match = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/.exec(line.text);
  if (!match) return false;

  const from = line.from + match[1].length;
  const checked = match[2] !== ' ';
  // Same-length replacement, so selections and marks either side survive.
  view.dispatch({
    changes: { from, to: from + 3, insert: checked ? '[ ]' : '[x]' },
    scrollIntoView: false,
  });
  return true;
}

/**
 * A task-list checkbox.
 *
 * `ignoreEvent` returns true (the CodeMirror default) so the editor does not
 * also treat the click as a cursor placement. Handling it would drop the caret
 * inside the marker, which unfolds the decoration and leaves raw `- [x]` text
 * on screen instead of the checkbox the user just clicked.
 */
export class TaskCheckboxWidget extends WidgetType {
  constructor(checked) {
    super();
    this.checked = checked;
  }

  eq(other) {
    return other.checked === this.checked;
  }

  toDOM(view) {
    // The box sits in a fixed-width wrapper rather than carrying a right
    // margin. CodeMirror places the caret using the widget's border box, which
    // excludes margins -- so a margin put the caret hard against the box on an
    // empty task line instead of where the text begins. Bullets already size
    // their gap this way.
    const wrap = document.createElement('span');
    wrap.className = 'cm-task';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'cm-task-checkbox';
    input.checked = this.checked;
    input.setAttribute('aria-label', 'Toggle task');

    // Suppress the default focus/selection side effects, then toggle on click
    // so the checkbox also responds to keyboard activation.
    input.addEventListener('mousedown', (event) => event.preventDefault());
    input.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleTaskAt(view, view.posAtDOM(wrap));
    });

    wrap.appendChild(input);
    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

/** Bullet for `-`, `*`, `+` list markers. */
export class BulletWidget extends WidgetType {
  constructor(depth) {
    super();
    this.depth = depth;
  }

  eq(other) {
    return other.depth === this.depth;
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-bullet';
    // Vary the glyph by nesting depth, the way outliners do.
    span.textContent = ['•', '◦', '‣'][this.depth % 3];
    return span;
  }
}

/** Number for `1.` / `1)` list markers. */
export class OrderedWidget extends WidgetType {
  constructor(text) {
    super();
    this.text = text;
  }

  eq(other) {
    return other.text === this.text;
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-ordered';
    span.textContent = this.text;
    return span;
  }
}

/** Rendered inline code, replacing the backticks. */
export class InlineCodeWidget extends WidgetType {
  constructor(code) {
    super();
    this.code = code;
  }

  eq(other) {
    return other.code === this.code;
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-inline-code';
    span.textContent = this.code;
    return span;
  }
}

/** Horizontal rule drawn as a real line. */
export class RuleWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-rule';
    return span;
  }
}

function renderMath(target, formula, displayMode) {
  try {
    katex.render(formula, target, { throwOnError: false, displayMode, strict: false });
  } catch (err) {
    target.textContent = formula;
    target.classList.add('cm-math-error');
  }
}

/** KaTeX-rendered math, inline or block. */
export class MathWidget extends WidgetType {
  constructor(formula, isBlock) {
    super();
    this.formula = formula;
    this.isBlock = isBlock;
  }

  eq(other) {
    return other.formula === this.formula && other.isBlock === this.isBlock;
  }

  toDOM() {
    const node = document.createElement(this.isBlock ? 'div' : 'span');
    node.className = this.isBlock ? 'cm-math-block' : 'cm-math-inline';
    renderMath(node, this.formula, this.isBlock);
    return node;
  }

  ignoreEvent() {
    return true;
  }
}
