// Headless checks for the rendering pipeline.
//
// Run with: npm test
//
// The checkbox cases exist because the obvious implementation silently breaks:
// if the editor is allowed to handle the widget's mouse event it moves the
// caret into the marker, which unfolds the decoration and shows raw `- [x]`
// text instead of toggling.

import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', {
  pretendToBeVisual: true,
});

// `navigator` is a getter-only global on modern Node, so every name has to be
// installed with defineProperty rather than plain assignment.
for (const name of [
  'window', 'document', 'navigator', 'getComputedStyle', 'requestAnimationFrame',
  'cancelAnimationFrame', 'Range', 'Node', 'Element', 'HTMLElement', 'DOMParser',
  'MutationObserver', 'MouseEvent', 'Event', 'KeyboardEvent', 'DOMRect',
]) {
  const value = name === 'window' ? dom.window : dom.window[name];
  if (value === undefined) continue;
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

const { EditorState, EditorSelection } = await import('@codemirror/state');
const { EditorView } = await import('@codemirror/view');
const { history } = await import('@codemirror/commands');
const { markdown, markdownLanguage, markdownKeymap } = await import('@codemirror/lang-markdown');
const { markdownDecorations } = await import('../src/decorations.js');
const { taskBracketInput } = await import('../src/input-rules.js');
const { indentListItem, outdentListItem, renumberSpecs, exitEmptyBlock, deleteMarkerBackward, moveBlockUp, moveBlockDown } = await import('../src/lists.js');
const { pasteMarkerFilter } = await import('../src/input-rules.js');
const { deleteMarkupBackward } = await import('@codemirror/lang-markdown');
const { insertNewlineContinueMarkup } = await import('@codemirror/lang-markdown');
const { COMMANDS } = await import('../src/format.js');
const { toggleExtension, toggleAt, isCollapsed, toggleRangeAt, isToggleStart } = await import('../src/toggle.js');
const { mathField } = await import('../src/math.js');
const { findLanguage } = await import('../src/languages.js');
const { cursorCharLeft, deleteCharBackward, undo } = await import('@codemirror/commands');

function makeView(doc, cursor = null) {
  const state = EditorState.create({
    doc,
    selection: cursor == null ? undefined : EditorSelection.single(cursor),
    extensions: [
      history(),
      toggleExtension,
      markdown({ base: markdownLanguage, codeLanguages: findLanguage }),
      markdownDecorations,
      mathField,
      taskBracketInput,
      pasteMarkerFilter,
      EditorView.lineWrapping,
    ],
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  return new EditorView({ state, parent: host });
}

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push(['pass', name]);
  } catch (err) {
    results.push(['FAIL', name, err.message]);
  }
}

const boxes = (view) => Array.from(view.dom.querySelectorAll('.cm-task-checkbox'));

/**
 * Presses Enter with the editor's real precedence: the block command gets
 * first refusal, then markdown's list continuation.
 */
function pressEnter(view) {
  if (exitEmptyBlock(view)) return;
  insertNewlineContinueMarkup(view);
}

/** Types `text` one character at a time at the caret, as a user would. */
function type(view, text) {
  for (const ch of text) {
    const at = view.state.selection.main.head;
    view.dispatch({
      changes: { from: at, insert: ch },
      selection: { anchor: at + 1 },
      userEvent: 'input.type',
    });
  }
}

// ── Checkbox rendering ──────────────────────────────────────────────────────

test('renders a checkbox for every task marker style', () => {
  const view = makeView('- [x] dash\n* [ ] star\n+ [x] plus\n1. [ ] ordered\n2) [x] paren');
  assert.equal(boxes(view).length, 5, 'expected one checkbox per task line');
});

test('checked state matches the marker', () => {
  const view = makeView('- [x] done\n- [ ] todo');
  assert.deepEqual(boxes(view).map((b) => b.checked), [true, false]);
});

test('list mark is consumed by the checkbox, not left behind', () => {
  // Guards two separate regressions: a raw `1. ` left beside the checkbox, and
  // a bullet *widget* drawn beside it because the list mark was not recognised
  // as part of the task. The bullet case is invisible to a text assertion, so
  // the widget count is checked too.
  for (const doc of ['- [x] a', '* [ ] a', '1. [x] a', '-   [x] a', '  - [ ] nested']) {
    const view = makeView(doc);
    const text = view.contentDOM.textContent;

    assert.equal(boxes(view).length, 1, `no checkbox for ${JSON.stringify(doc)}`);
    assert.equal(
      view.dom.querySelectorAll('.cm-bullet, .cm-ordered').length, 0,
      `bullet drawn beside the checkbox for ${JSON.stringify(doc)}`
    );
    assert.ok(
      !/[-*+]\s*\[|\d[.)]\s*\[/.test(text),
      `leftover marker in ${JSON.stringify(doc)}: ${JSON.stringify(text)}`
    );
    assert.ok(
      !/^[\s•◦‣]*[-*+\d]/.test(text),
      `stray list marker in ${JSON.stringify(doc)}: ${JSON.stringify(text)}`
    );
  }
});

test('typing "[] " leaves a checkbox and no bullet', () => {
  // End to end: the input rule rewrites `[] ` to `- [ ] `, and the renderer
  // must then fold that dash into the checkbox rather than drawing a bullet.
  const view = makeView('', 0);
  type(view, '[] ');
  assert.equal(view.state.doc.toString(), '- [ ] ');
  assert.equal(boxes(view).length, 1, 'no checkbox rendered');
  assert.equal(view.dom.querySelectorAll('.cm-bullet, .cm-ordered').length, 0, 'bullet beside checkbox');
});

test('nested task keeps its indentation', () => {
  const view = makeView('- [ ] top\n    - [ ] child');
  assert.equal(boxes(view).length, 2);
  assert.ok(view.contentDOM.textContent.includes('child'));
});

// ── Checkbox interaction ────────────────────────────────────────────────────

test('clicking a checkbox toggles the source text', () => {
  const view = makeView('- [ ] todo', 0);
  // Put the caret elsewhere so the marker is actually rendered.
  view.dispatch({ selection: EditorSelection.single(view.state.doc.length) });

  const box = boxes(view)[0];
  assert.ok(box, 'checkbox not rendered');
  box.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(view.state.doc.toString(), '- [x] todo');
});

test('clicking toggles back off', () => {
  const view = makeView('- [x] todo');
  view.dispatch({ selection: EditorSelection.single(view.state.doc.length) });
  boxes(view)[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(view.state.doc.toString(), '- [ ] todo');
});

test('clicking the second task toggles that task only', () => {
  const view = makeView('- [ ] first\n- [ ] second');
  view.dispatch({ selection: EditorSelection.single(view.state.doc.length) });
  const all = boxes(view);
  assert.equal(all.length, 2);
  all[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(view.state.doc.toString(), '- [x] first\n- [ ] second');
});

test('toggling an ordered task rewrites only its box', () => {
  const view = makeView('1. [ ] one\n2. [ ] two');
  view.dispatch({ selection: EditorSelection.single(view.state.doc.length) });
  boxes(view)[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(view.state.doc.toString(), '1. [ ] one\n2. [x] two');
});

test('the caret does not jump into the marker after a click', () => {
  const view = makeView('- [ ] todo');
  const end = view.state.doc.length;
  view.dispatch({ selection: EditorSelection.single(end) });
  boxes(view)[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(view.state.selection.main.head, end, 'caret moved into the task marker');
  assert.equal(boxes(view).length, 1, 'checkbox disappeared after being clicked');
});

// ── Input rules ─────────────────────────────────────────────────────────────

test('typing "- [] " expands to a real task box', () => {
  // The note recovered from the old app was full of `- []`, which GFM does not
  // recognise, so the list rendered as plain text with no checkbox.
  const view = makeView('- ', 2);
  type(view, '[] ');
  assert.equal(view.state.doc.toString(), '- [ ] ');
});

test('a bracket outside a list is left alone', () => {
  const view = makeView('array', 5);
  type(view, '[] ');
  assert.equal(view.state.doc.toString(), 'array[] ');
});

test('typing "[] " on its own line becomes a task item', () => {
  // Notion creates a to-do from a bare `[]`, with no bullet typed first.
  const view = makeView('', 0);
  type(view, '[] ');
  assert.equal(view.state.doc.toString(), '- [ ] ');
});

test('"[]" without a space is left as typed', () => {
  // The space commits the shortcut, exactly as it does for `# ` and `- `.
  const view = makeView('', 0);
  type(view, '[]');
  assert.equal(view.state.doc.toString(), '[]');
  assert.equal(boxes(view).length, 0, 'should not convert before the space');
});

test('the space still commits after a pause in typing', () => {
  const view = makeView('', 0);
  type(view, '[]');
  assert.equal(view.state.doc.toString(), '[]');
  type(view, ' ');
  assert.equal(view.state.doc.toString(), '- [ ] ');
});

test('"[] " converts a line that already has text', () => {
  // Same as typing `### ` or `- ` in front of an existing line.
  const view = makeView('할 일 내용', 0);
  type(view, '[] ');
  assert.equal(view.state.doc.toString(), '- [ ] 할 일 내용');
  assert.equal(boxes(view).length, 1, 'checkbox not rendered');
});

test('"- [] " converts a list line that already has text', () => {
  const view = makeView('- 기존 항목', 2);
  type(view, '[] ');
  assert.equal(view.state.doc.toString(), '- [ ] 기존 항목');
});

test('an indented line converts and keeps its indent', () => {
  const view = makeView('  nested text', 2);
  type(view, '[] ');
  assert.equal(view.state.doc.toString(), '  - [ ] nested text');
});

test('a space already on the line is absorbed', () => {
  // Otherwise the typed space plus the existing one would leave a double gap.
  const view = makeView(' todo', 0);
  type(view, '[] ');
  assert.equal(view.state.doc.toString(), '- [ ] todo');
});

test('the caret lands after the checkbox, ready to type', () => {
  const view = makeView('text', 0);
  type(view, '[] ');
  assert.equal(view.state.doc.toString(), '- [ ] text');
  assert.equal(view.state.selection.main.head, 6, 'caret should sit just before "text"');
});

test('"[] " inside a fenced code block stays literal', () => {
  // Go slices and array literals start exactly this way.
  const view = makeView('```go\n\n```', 6);
  type(view, '[] ');
  assert.equal(view.state.doc.toString(), '```go\n[] \n```');
});

test('"[] " mid-line is left alone', () => {
  const view = makeView('const a = arr', 13);
  type(view, '[] ');
  assert.equal(view.state.doc.toString(), 'const a = arr[] ');
});

// ── Notion-style block prefixes ─────────────────────────────────────────────

const rendered = (view) => view.contentDOM.textContent;

test('a heading hides its "###" once the space is typed', () => {
  const view = makeView('### Section', 11);
  assert.ok(!rendered(view).includes('#'), `still showing hashes: ${JSON.stringify(rendered(view))}`);
  assert.ok(rendered(view).includes('Section'));
  assert.equal(view.state.doc.toString(), '### Section', 'source must stay valid markdown');
});

test('the caret on the heading line does not bring "###" back', () => {
  // The whole point of the Notion style: the prefix never reappears.
  for (const caret of [4, 6, 11]) {
    const view = makeView('### Section', caret);
    assert.ok(!rendered(view).includes('#'), `hashes visible with caret at ${caret}`);
  }
});

test('hashes stay visible until the space is typed', () => {
  // Otherwise the first keystroke of the shortcut silently vanishes.
  const view = makeView('###', 3);
  assert.ok(rendered(view).includes('###'), 'bare "###" should still be visible');
});

test('"#" alone is not yet styled as a heading', () => {
  // The parser calls `#` an empty heading immediately; styling it that early
  // makes the font jump before the user has typed the space.
  for (const doc of ['#', '##', '###']) {
    const view = makeView(doc, doc.length);
    assert.ok(
      !/cm-md-h\d/.test(view.contentDOM.innerHTML),
      `${JSON.stringify(doc)} should still look like body text`
    );
  }
});

test('the space is what turns it into a heading', () => {
  const view = makeView('## ', 3);
  assert.ok(/cm-md-h2/.test(view.contentDOM.innerHTML), 'heading style should apply after the space');
  assert.ok(!rendered(view).includes('#'), 'hashes should be hidden by then');
});

test('emphasis markers stay hidden with the caret inside', () => {
  for (const caret of [0, 3, 5, 8]) {
    const view = makeView('**bold** x', caret);
    assert.ok(
      !rendered(view).includes('*'),
      `asterisks visible with caret at ${caret}: ${JSON.stringify(rendered(view))}`
    );
  }
});

test('strikethrough markers stay hidden too', () => {
  const view = makeView('~~gone~~ x', 4);
  assert.ok(!rendered(view).includes('~'), `tildes visible: ${JSON.stringify(rendered(view))}`);
});

test('emphasis text itself is never hidden', () => {
  const view = makeView('**bold** and *soft*', 2);
  assert.ok(rendered(view).includes('bold'));
  assert.ok(rendered(view).includes('soft'));
});

test('">" alone is not yet a toggle', () => {
  // The parser calls a bare `>` an empty blockquote immediately; acting on
  // that pops the arrow and hint into place a keystroke early.
  const view = makeView('>', 1);
  assert.equal(view.contentDOM.querySelector('.cm-toggle-arrow'), null, 'arrow too early');
  assert.equal(view.contentDOM.querySelector('.cm-toggle-hint'), null, 'hint too early');
  assert.ok(!view.contentDOM.innerHTML.includes('cm-md-toggle-title'), 'styled too early');
  assert.ok(rendered(view).includes('>'), 'the character itself should still show');
});

test('the space is what turns ">" into a toggle', () => {
  const view = makeView('> ', 2);
  assert.ok(view.contentDOM.querySelector('.cm-toggle-arrow'), 'arrow missing after the space');
  assert.ok(view.contentDOM.innerHTML.includes('cm-md-toggle-title'), 'title styling missing');
  assert.ok(!rendered(view).includes('>'), 'marker should be hidden by then');
});

test('typing "> " step by step only commits on the space', () => {
  const view = makeView('', 0);
  type(view, '>');
  assert.equal(view.contentDOM.querySelector('.cm-toggle-arrow'), null, 'fired on ">"');
  type(view, ' ');
  assert.ok(view.contentDOM.querySelector('.cm-toggle-arrow'), 'did not fire on the space');
});

test('a bare ">" is not foldable', () => {
  const view = makeView('>\n> body', 1);
  assert.equal(isToggleStart(view.state, 0), false);
  assert.equal(toggleRangeAt(view.state, 0), null, 'should not offer to fold');
});

test('a toggle hides its "> " marker', () => {
  const view = makeView('> toggle title', 14);
  assert.ok(!rendered(view).includes('>'), `still showing marker: ${JSON.stringify(rendered(view))}`);
  assert.ok(rendered(view).includes('toggle title'));
});

test('the checkbox carries its gap inside its own box', () => {
  // CodeMirror positions the caret from the widget's border box, which
  // excludes margins. With the gap as a right margin the caret sat hard
  // against the box on an empty task line instead of where text begins.
  const view = makeView('- [ ] a');
  const box = view.contentDOM.querySelector('.cm-task-checkbox');
  assert.ok(box, 'no checkbox');
  assert.ok(box.parentElement.classList.contains('cm-task'),
    'checkbox should sit in the fixed-width wrapper that provides the gap');
});

test('clicking still toggles through the wrapper', () => {
  const view = makeView('- [ ] todo');
  view.dispatch({ selection: EditorSelection.single(view.state.doc.length) });
  boxes(view)[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(view.state.doc.toString(), '- [x] todo');
});

test('an empty task line still renders its checkbox', () => {
  const view = makeView('- [ ] a\n- [ ] ');
  assert.equal(boxes(view).length, 2, 'the empty trailing task lost its box');
});

test('a checkbox stays rendered with the caret on it', () => {
  // Contrast with the old behaviour, where the caret unfolded it to "- [ ]".
  for (const caret of [0, 2, 3, 6]) {
    const view = makeView('- [ ] todo', caret);
    assert.equal(boxes(view).length, 1, `checkbox vanished with caret at ${caret}`);
    assert.ok(!rendered(view).includes('['), `raw marker shown with caret at ${caret}`);
  }
});

test('the caret steps over a hidden heading prefix instead of into it', () => {
  // Without atomic ranges the caret would stop at offsets 3, 2, 1 inside text
  // the user cannot see.
  const view = makeView('### Section', 4);   // start of "Section"
  cursorCharLeft(view);
  assert.equal(view.state.selection.main.head, 0,
    'caret landed inside the hidden "### " prefix');
});

test('backspace at the start of a heading removes the whole prefix', () => {
  const view = makeView('### Section', 4);
  deleteCharBackward(view);
  assert.equal(view.state.doc.toString(), 'Section',
    'heading should collapse back to a paragraph in one keystroke');
});

test('bullet markers render as bullets, caret or not', () => {
  const view = makeView('- one\n- two', 2);
  assert.ok(!rendered(view).includes('- '), `raw dash shown: ${JSON.stringify(rendered(view))}`);
});

// ── Other markdown ──────────────────────────────────────────────────────────

test('headings, emphasis and strikethrough are decorated', () => {
  const view = makeView('# Title\n\n**bold** *it* ~~gone~~');
  const html = view.contentDOM.innerHTML;
  assert.ok(html.includes('cm-md-h1'), 'heading');
  assert.ok(html.includes('cm-md-strong'), 'bold');
  assert.ok(html.includes('cm-md-em'), 'italic');
  assert.ok(html.includes('cm-md-strike'), 'strikethrough');
});

test('tables and quotes are decorated', () => {
  const view = makeView('| quoted\n\n| a | b |\n|---|---|\n| 1 | 2 |', 0);
  const html = view.contentDOM.innerHTML;
  assert.ok(html.includes('cm-md-quote'), 'quote');
  assert.ok(html.includes('cm-md-table'), 'table');
});

test('inline code renders as a widget away from the caret', () => {
  const view = makeView('use `npm run build` now', 0);
  assert.ok(view.contentDOM.innerHTML.includes('cm-inline-code'), 'inline code widget');
});

test('math renders and a dollar amount does not', () => {
  const view = makeView('Euler: $e^{i\\pi}+1=0$ end', 0);
  assert.ok(view.contentDOM.innerHTML.includes('katex'), 'inline math should render');

  const prices = makeView('it costs $5 and $6 total', 0);
  assert.ok(!prices.contentDOM.innerHTML.includes('katex'), 'prices must not render as math');
});

test('dollars inside code are left alone', () => {
  const view = makeView('run `echo $HOME` and `echo $PATH`', 0);
  assert.ok(!view.contentDOM.innerHTML.includes('katex'), 'shell vars must not render as math');
});

// ── List nesting (Tab / Shift-Tab) ──────────────────────────────────────────

/** Builds a view with the caret on `lineNumber` (1-based), at end of line. */
function viewOnLine(doc, lineNumber) {
  const view = makeView(doc, 0);
  const line = view.state.doc.line(lineNumber);
  view.dispatch({ selection: EditorSelection.single(line.to) });
  return view;
}

test('Tab nests a bullet under the item above it', () => {
  const view = viewOnLine('- one\n- two', 2);
  assert.equal(indentListItem(view), true);
  assert.equal(view.state.doc.toString(), '- one\n  - two');
});

test('Tab nests under an ordered item by its marker width', () => {
  // "1. " is three columns wide, so a child must indent by three -- not the
  // two that a generic indent command would insert.
  const view = viewOnLine('1. one\n1. two', 2);
  assert.equal(indentListItem(view), true);
  assert.equal(view.state.doc.toString(), '1. one\n   1. two');
});

test('Tab does nothing on the first item of a list', () => {
  // Matches Notion: there is no sibling above to nest under.
  const view = viewOnLine('- only', 1);
  assert.equal(indentListItem(view), false);
  assert.equal(view.state.doc.toString(), '- only');
});

test('Tab carries nested children along with the item', () => {
  const view = viewOnLine('- one\n- two\n  - child', 2);
  assert.equal(indentListItem(view), true);
  assert.equal(view.state.doc.toString(), '- one\n  - two\n    - child');
});

test('Shift-Tab lifts an item back out', () => {
  const view = viewOnLine('- one\n  - two', 2);
  assert.equal(outdentListItem(view), true);
  assert.equal(view.state.doc.toString(), '- one\n- two');
});

test('Shift-Tab does nothing at the outermost level', () => {
  const view = viewOnLine('- one\n- two', 2);
  assert.equal(outdentListItem(view), false);
});

test('Tab outside a list is declined so plain indent can handle it', () => {
  const view = viewOnLine('just text', 1);
  assert.equal(indentListItem(view), false);
});

// ── Ordered numbering ───────────────────────────────────────────────────────

test('nesting renumbers both levels in one step', () => {
  const view = viewOnLine('1. one\n2. two\n3. three', 2);
  indentListItem(view);
  // "two" becomes the first item of a nested list, so it restarts at 1 and
  // "three" closes the gap it left behind.
  assert.equal(view.state.doc.toString(), '1. one\n   1. two\n2. three');
});

test('nesting and renumbering are a single undo step', () => {
  const before = '1. one\n2. two\n3. three';
  const view = viewOnLine(before, 2);
  indentListItem(view);
  assert.notEqual(view.state.doc.toString(), before);
  undo(view);
  assert.equal(view.state.doc.toString(), before, 'one undo should reverse the whole operation');
});

test('renumbering keeps each level on its own counter', () => {
  const doc = '1. a\n1. b\n   1. x\n   1. y\n1. c';
  const view = makeView(doc, 0);
  const specs = renumberSpecs(view.state.doc);
  let out = doc;
  for (const spec of [...specs].reverse()) {
    out = out.slice(0, spec.from) + spec.insert + out.slice(spec.to);
  }
  assert.equal(out, '1. a\n2. b\n   1. x\n   2. y\n3. c');
});

test('a list keeps the starting number of its first item', () => {
  const view = makeView('5. five\n5. six', 0);
  const specs = renumberSpecs(view.state.doc);
  assert.equal(specs.length, 1);
  assert.equal(specs[0].insert, '6.');
});

test('a blank gap starts a new list', () => {
  const view = makeView('1. a\n2. b\n\n\n1. fresh', 0);
  assert.deepEqual(renumberSpecs(view.state.doc), [], 'the second list should stay at 1');
});

test('displayed numbers are sequential even when the source is not', () => {
  // `1.` repeated is legal markdown and renders as 1, 2, 3 everywhere.
  const view = makeView('1. a\n1. b\n1. c');
  const labels = [...view.dom.querySelectorAll('.cm-ordered')].map((n) => n.textContent);
  assert.deepEqual(labels, ['1.', '2.', '3.']);
});

test('a nested ordered list restarts its displayed numbering', () => {
  const view = makeView('1. a\n2. b\n   1. x\n   2. y\n3. c');
  const labels = [...view.dom.querySelectorAll('.cm-ordered')].map((n) => n.textContent);
  assert.deepEqual(labels, ['1.', '2.', '1.', '2.', '3.']);
});

test('nested items get a depth class and drop their literal indent', () => {
  const view = makeView('- one\n  - two\n    - three');
  const html = view.contentDOM.innerHTML;
  assert.ok(html.includes('cm-md-indent-1'), 'second level should be indented');
  assert.ok(html.includes('cm-md-indent-2'), 'third level should be indented');
  // The spaces are replaced by padding, so they must not also render as text.
  assert.ok(!/^\s/m.test(rendered(view)), `literal indent left in: ${JSON.stringify(rendered(view))}`);
});

test('nesting depth follows the tree, not the space count', () => {
  // An ordered child indents by three columns, a bullet child by two; both are
  // still depth 1.
  const ordered = makeView('1. one\n   1. two');
  const bullet = makeView('- one\n  - two');
  for (const view of [ordered, bullet]) {
    assert.ok(view.contentDOM.innerHTML.includes('cm-md-indent-1'));
    assert.ok(!view.contentDOM.innerHTML.includes('cm-md-indent-2'));
  }
});

// ── Quote (`| `) and toggle (`> `) ──────────────────────────────────────────

test('"| " renders as a quote with its marker hidden', () => {
  const view = makeView('| quoted line');
  const html = view.contentDOM.innerHTML;
  assert.ok(html.includes('cm-md-quote'), 'quote styling missing');
  assert.ok(!rendered(view).includes('|'), `marker still shown: ${JSON.stringify(rendered(view))}`);
  assert.ok(rendered(view).includes('quoted line'));
});

test('a table is not mistaken for a quote', () => {
  // Every GFM table row starts with `|`, so this is the collision that the
  // reserved-line pass exists to prevent.
  const view = makeView('| a | b |\n|---|---|\n| 1 | 2 |');
  const html = view.contentDOM.innerHTML;
  assert.ok(html.includes('cm-md-table'), 'table styling missing');
  assert.ok(!html.includes('cm-md-quote'), 'table rows styled as quotes');
});

test('a pipe inside fenced code is left alone', () => {
  const view = makeView('```sh\n| grep x\n```');
  assert.ok(!view.contentDOM.innerHTML.includes('cm-md-quote'), 'code line styled as a quote');
});

test('"> " renders as a toggle, not a quote', () => {
  const view = makeView('> Title\n> body');
  const html = view.contentDOM.innerHTML;
  assert.ok(html.includes('cm-md-toggle-title'), 'toggle title missing');
  assert.ok(html.includes('cm-toggle-arrow'), 'arrow missing');
  assert.ok(!html.includes('cm-md-quote'), 'toggle styled as a quote');
  assert.ok(!rendered(view).includes('>'), 'marker still shown');
});

test('a toggle collapses and expands its body', () => {
  const view = makeView('> Title\n> hidden\n> also hidden\nafter');
  const titleStart = 0;

  assert.equal(isCollapsed(view.state, titleStart), false, 'should start expanded');
  assert.equal(toggleAt(view, titleStart), true);
  assert.equal(isCollapsed(view.state, titleStart), true, 'should now be collapsed');

  assert.equal(toggleAt(view, titleStart), true);
  assert.equal(isCollapsed(view.state, titleStart), false, 'should expand again');
});

test('collapsing hides the body but keeps the title and the text after it', () => {
  // The blank line matters: without it markdown's lazy continuation folds
  // `after` into the blockquote, so it would legitimately be hidden too.
  const view = makeView('> Title\n> hidden line\n\nafter');
  toggleAt(view, 0);
  const text = rendered(view);
  assert.ok(text.includes('Title'), 'title should stay visible');
  assert.ok(!text.includes('hidden line'), `body still shown: ${JSON.stringify(text)}`);
  assert.ok(text.includes('after'), 'content after the toggle should stay visible');
});

test('collapsing never changes the document', () => {
  const doc = '> Title\n> body';
  const view = makeView(doc);
  toggleAt(view, 0);
  assert.equal(view.state.doc.toString(), doc, 'folding must be a view concern only');
});

test('a single-line toggle has nothing to collapse', () => {
  const view = makeView('> Just a title\n\nplain');
  assert.equal(toggleRangeAt(view.state, 0), null);
  assert.equal(toggleAt(view, 0), false);
  // The arrow is still drawn, just inert.
  assert.ok(view.contentDOM.innerHTML.includes('cm-toggle-inert'));
});

test('an empty toggle shows a hint line', () => {
  const view = makeView('> Just a title\n\nplain');
  const hint = view.contentDOM.querySelector('.cm-toggle-hint');
  assert.ok(hint, 'hint missing');
  assert.ok(hint.textContent.includes('Enter'), `unexpected hint: ${hint.textContent}`);
});

test('the hint disappears once the toggle has a body', () => {
  const view = makeView('> Title\n> body');
  assert.equal(view.contentDOM.querySelectorAll('.cm-toggle-hint').length, 0);
});

test('the hint is not part of the document', () => {
  const doc = '> Just a title';
  const view = makeView(doc);
  assert.equal(view.state.doc.toString(), doc, 'hint must be decoration only');
});

test('pressing Enter fills the toggle and clears the hint', () => {
  // The hint tells the user to press Enter, so that has to actually work.
  const view = makeView('> Title', 7);
  const enter = markdownKeymap.find((b) => b.key === 'Enter');
  enter.run(view);
  assert.equal(view.state.doc.toString(), '> Title\n> ');
  assert.equal(view.contentDOM.querySelectorAll('.cm-toggle-hint').length, 0, 'hint should be gone');
  assert.ok(view.contentDOM.innerHTML.includes('cm-toggle-arrow'), 'arrow should remain');
});

test('the arrow is drawn as a shape, not a font glyph', () => {
  // Text triangles differ in size and baseline between fonts.
  const view = makeView('> Title\n> body');
  assert.ok(view.contentDOM.querySelector('.cm-toggle-arrow svg'), 'expected an svg arrow');
});

test('only the title line toggles', () => {
  const view = makeView('> Title\n> body');
  const bodyStart = view.state.doc.line(2).from;
  assert.equal(toggleRangeAt(view.state, bodyStart), null, 'body lines must not fold');
});

test('lazy continuation is part of the toggle, as markdown defines it', () => {
  // A line directly after a quote with no blank between is a continuation of
  // it, so collapsing correctly takes it along.
  const view = makeView('> Title\n> body\ntrailing');
  toggleAt(view, 0);
  assert.ok(!rendered(view).includes('trailing'));
});

test('a collapsed toggle still draws exactly one arrow', () => {
  // Folding splits `visibleRanges` in two, and the toggle's own Blockquote
  // spans the gap -- so the tree walk enters it once per range. Without
  // deduplication that drew a second arrow beside the first.
  const view = makeView('> Title\n> body one\n> body two\n\nafter');
  assert.equal(view.dom.querySelectorAll('.cm-toggle-arrow').length, 1, 'expanded');

  toggleAt(view, 0);
  assert.ok(view.visibleRanges.length > 1, 'this test is only meaningful once folding splits the ranges');
  assert.equal(view.dom.querySelectorAll('.cm-toggle-arrow').length, 1, 'collapsed');
});

test('a collapsed toggle renders its title exactly once', () => {
  const view = makeView('> Title\n> body\n\nafter');
  toggleAt(view, 0);
  const text = rendered(view);
  assert.equal(text.split('Title').length - 1, 1, `title duplicated: ${JSON.stringify(text)}`);
  assert.ok(!text.includes('body'), 'body should be hidden');
  assert.ok(text.includes('after'), 'following text should stay visible');
});

test('decorations either side of a fold are not duplicated', () => {
  // The same splitting affects every construct that spans the gap.
  const view = makeView('> Title\n> body\n\n- [ ] task\n**bold**');
  toggleAt(view, 0);
  assert.equal(view.dom.querySelectorAll('.cm-task-checkbox').length, 1, 'checkbox duplicated');
  assert.equal(rendered(view).split('bold').length - 1, 1, 'bold text duplicated');
});

// ── Enter on list items ─────────────────────────────────────────────────────

/** Builds a view with the caret at the end of the document. */
const atEnd = (doc) => makeView(doc, doc.length);

test('Enter on a task continues the list', () => {
  const view = atEnd('- [ ] 할일');
  pressEnter(view);
  assert.equal(view.state.doc.toString(), '- [ ] 할일\n- [ ] ');
});

test('Enter on an empty task leaves the list instead of doubling the break', () => {
  // The bug: `insertNewlineContinueMarkup` inserts a blank line and carries
  // the marker down, so Enter looks like it broke the line twice and the list
  // can never be escaped.
  const view = atEnd('- [ ] 할일\n- [ ] ');
  pressEnter(view);
  assert.equal(view.state.doc.toString(), '- [ ] 할일\n');
});

test('two Enters escape a task list and land on a blank line', () => {
  const view = atEnd('- [ ] 할일');
  pressEnter(view);
  pressEnter(view);
  assert.equal(view.state.doc.toString(), '- [ ] 할일\n');
  assert.equal(view.state.selection.main.head, view.state.doc.length, 'caret should be on the empty line');
});

test('empty bullets, numbers and quotes all exit the same way', () => {
  for (const [doc, expected] of [
    ['- a\n- ', '- a\n'],
    ['1. a\n2. ', '1. a\n'],
    ['* a\n* ', '* a\n'],
    ['> a\n> ', '> a\n'],
  ]) {
    const view = atEnd(doc);
    pressEnter(view);
    assert.equal(view.state.doc.toString(), expected, `from ${JSON.stringify(doc)}`);
  }
});

test('an empty nested item outdents before leaving', () => {
  // Notion walks out one level per Enter rather than jumping to the margin.
  const view = atEnd('- a\n  - nested\n  - ');
  pressEnter(view);
  assert.equal(view.state.doc.toString(), '- a\n  - nested\n- ');
  pressEnter(view);
  assert.equal(view.state.doc.toString(), '- a\n  - nested\n');
});

test('Enter on an item with text still continues the list', () => {
  const view = atEnd('- [x] done');
  pressEnter(view);
  assert.equal(view.state.doc.toString(), '- [x] done\n- [ ] ');
});

test('Enter on plain text is left to the default command', () => {
  const view = atEnd('just text');
  assert.equal(exitEmptyBlock(view), false, 'should decline so the default runs');
});

test('Enter with a selection is left alone', () => {
  const view = makeView('- [ ] ', 0);
  view.dispatch({ selection: { anchor: 0, head: 6 } });
  assert.equal(exitEmptyBlock(view), false, 'a range selection is not an empty-item Enter');
});

// ── Emphasis never swallows markers or whitespace ───────────────────────────

/** Selects [from, to) and applies a formatting command. */
function format(view, command, from, to) {
  view.dispatch({ selection: { anchor: from, head: to } });
  COMMANDS[command](view);
  return view.state.doc.toString();
}

test('bold on a whole task line wraps only the text', () => {
  // The bug: selecting the line picked up `- [ ] `, producing
  // `- [ ] ** CHI Review**`, which GFM renders as literal asterisks because
  // emphasis cannot open before a space.
  const doc = '- [ ] CHI Review ~10/22';
  const view = makeView(doc, 0);
  assert.equal(format(view, 'bold', 0, doc.length), '- [ ] **CHI Review ~10/22**');
});

test('bold ignores leading and trailing whitespace in the selection', () => {
  const doc = 'hello world';
  const view = makeView(doc, 0);
  // Selection has slack either side of "hello".
  assert.equal(format(view, 'bold', 0, 6), '**hello** world');
});

test('bold skips a bullet marker', () => {
  const doc = '- item text';
  const view = makeView(doc, 0);
  assert.equal(format(view, 'bold', 0, doc.length), '- **item text**');
});

test('bold skips heading hashes and quote marks', () => {
  for (const [doc, expected] of [
    ['### Title', '### **Title**'],
    ['> quoted', '> **quoted**'],
    ['1. numbered', '1. **numbered**'],
    ['  - [x] done', '  - [x] **done**'],
  ]) {
    const view = makeView(doc, 0);
    assert.equal(format(view, 'bold', 0, doc.length), expected, `from ${JSON.stringify(doc)}`);
  }
});

test('bold with no selection inserts the pair at the caret', () => {
  // Trimming must not apply here: it would teleport the caret past the
  // line's marker before inserting.
  const view = makeView('- [ ] text', 0);
  COMMANDS.bold(view);
  assert.equal(view.state.doc.toString(), '****- [ ] text');
  assert.equal(view.state.selection.main.head, 2, 'caret should sit between the markers');
});

test('bold still toggles off', () => {
  const doc = '- [ ] **text**';
  const view = makeView(doc, 0);
  assert.equal(format(view, 'bold', 0, doc.length), '- [ ] text');
});

test('italic and code trim the same way', () => {
  const view1 = makeView('- [ ] text', 0);
  assert.equal(format(view1, 'italic', 0, 10), '- [ ] *text*');
  const view2 = makeView('- [ ] text', 0);
  assert.equal(format(view2, 'code', 0, 10), '- [ ] `text`');
});

test('a link built from a whole task line keeps the marker outside', () => {
  const doc = '- [ ] label';
  const view = makeView(doc, 0);
  assert.equal(format(view, 'link', 0, doc.length), '- [ ] [label](url)');
});

// ── Bracket labels vs real links ────────────────────────────────────────────

/**
 * Classes applied to `needle` in the rendered line.
 *
 * These markers are hidden with CSS rather than replaced, so they still appear
 * in textContent -- the class is what says whether they are visible.
 */
function classesAround(view, needle) {
  for (const el of view.contentDOM.querySelectorAll('span')) {
    if (el.textContent === needle) return el.className;
  }
  return null;
}

test('a target-less "[label]" keeps its brackets visible', () => {
  // Hiding them leaves a zero-width gap at the end that swallows clicks: the
  // caret lands between the text and the invisible "]".
  const view = makeView('[mbc] 회의', 8);
  const cls = classesAround(view, '[');
  assert.ok(cls, 'no span around the bracket');
  assert.ok(cls.includes('cm-md-bracket'), `expected cm-md-bracket, got ${cls}`);
  assert.ok(!cls.includes('cm-md-marker'), `brackets are being hidden: ${cls}`);
});

test('a real link still hides its brackets', () => {
  const view = makeView('see [text](url) here', 0);
  const cls = classesAround(view, '[');
  assert.ok(cls, 'no span around the bracket');
  assert.ok(cls.includes('cm-md-marker'), `expected the hidden class, got ${cls}`);
  assert.ok(!cls.includes('cm-md-bracket'), `treated as a plain label: ${cls}`);
});

test('a bracket label is still underlined as a link', () => {
  const view = makeView('[mbc] 회의', 8);
  assert.ok(view.contentDOM.innerHTML.includes('cm-md-link'), 'underline styling missing');
});

// ── Backspace on a marker ───────────────────────────────────────────────────

/** Backspace with the editor's real precedence: ours, markdown's, then the default. */
function pressBackspace(view) {
  if (deleteMarkerBackward(view)) return;
  if (deleteMarkupBackward(view)) return;
  deleteCharBackward(view);
}

/** Puts the caret where the line's text starts. */
function caretAtTextStart(view, lineNumber) {
  const line = view.state.doc.line(lineNumber);
  const prefix = /^[ \t]*(?:(?:>[ \t]*)+|(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]*)?)/.exec(line.text);
  view.dispatch({ selection: EditorSelection.single(line.from + (prefix ? prefix[0].length : 0)) });
  return view;
}

test('Backspace on a nested checkbox leaves no stray indent', () => {
  // The bug: `deleteMarkupBackward` swaps the marker for spaces of the same
  // width, so `  - [ ] x` became eight spaces and `x` floated away from the
  // margin -- deep enough that markdown reads it as a code block.
  const view = makeView('- [ ] parent\n  - [ ] child', 0);
  caretAtTextStart(view, 2);
  pressBackspace(view);
  assert.equal(view.state.doc.toString(), '- [ ] parent\nchild');
});

test('Backspace on a top-level checkbox clears the whole marker', () => {
  const view = makeView('- [x] done', 0);
  caretAtTextStart(view, 1);
  pressBackspace(view);
  assert.equal(view.state.doc.toString(), 'done');
});

test('no leading whitespace survives, at any depth', () => {
  for (const doc of ['- [ ] a', '  - [ ] a', '    - [x] a', '  - a', '  1. a', '> a', '  > a']) {
    const view = makeView(doc, 0);
    caretAtTextStart(view, 1);
    pressBackspace(view);
    assert.equal(view.state.doc.toString(), 'a', `from ${JSON.stringify(doc)}`);
  }
});

test('Backspace inside the text still deletes one character', () => {
  const view = makeView('- [ ] text', 0);
  view.dispatch({ selection: EditorSelection.single(10) });
  pressBackspace(view);
  assert.equal(view.state.doc.toString(), '- [ ] tex');
});

test('Backspace at the very start of the line is left alone', () => {
  const view = makeView('- [ ] a\n- [ ] b', 0);
  const line = view.state.doc.line(2);
  view.dispatch({ selection: EditorSelection.single(line.from) });
  assert.equal(deleteMarkerBackward(view), false, 'should decline so lines can be joined');
});

test('Backspace with a selection is left alone', () => {
  const view = makeView('- [ ] text', 0);
  view.dispatch({ selection: { anchor: 6, head: 10 } });
  assert.equal(deleteMarkerBackward(view), false);
});

test('Backspace on a plain line is left alone', () => {
  const view = makeView('plain text', 0);
  view.dispatch({ selection: EditorSelection.single(5) });
  assert.equal(deleteMarkerBackward(view), false);
});

// ── Arrow keys across a marker ──────────────────────────────────────────────

/** Caret positions walking left from `start`, until it reaches `stopAt`. */
function caretStops(view, start, stopAt = 0) {
  view.dispatch({ selection: EditorSelection.single(start) });
  const stops = [start];
  for (let i = 0; i < 12 && view.state.selection.main.head > stopAt; i += 1) {
    cursorCharLeft(view);
    stops.push(view.state.selection.main.head);
  }
  return stops;
}

test('Left from the first character jumps straight past the marker', () => {
  // Two separate hidden ranges (the indent, then the marker) made the caret
  // stop twice at the same visual spot, which reads as a space sitting before
  // the first character.
  for (const [doc, textStart] of [
    ['- [ ] ab', 6],
    ['  - [ ] ab', 8],
    ['- ab', 2],
    ['  - ab', 4],
    ['1. ab', 3],
    ['  1. ab', 5],
  ]) {
    const view = makeView(doc, 0);
    const stops = caretStops(view, textStart);
    assert.deepEqual(stops, [textStart, 0],
      `${JSON.stringify(doc)} should step straight to the line start, got ${stops.join(' ')}`);
  }
});

test('no caret position sits on hidden whitespace', () => {
  // Every stop must be either the line start or somewhere in the visible text.
  const view = makeView('  - [x] done', 0);
  for (const pos of caretStops(view, 12)) {
    assert.ok(pos === 0 || pos >= 8, `caret stopped at ${pos}, inside the hidden marker`);
  }
});

test('spaces typed after a checkbox actually appear', () => {
  // The marker range used to eat every following space, so pressing space on
  // a task line looked like the key had stopped working entirely.
  const view = makeView('', 0);
  type(view, '[] ');
  assert.equal(view.state.doc.toString(), '- [ ] ');

  type(view, ' ');
  assert.equal(view.state.doc.toString(), '- [ ]  ');
  assert.equal(rendered(view), ' ', 'the typed space should be visible');

  type(view, 'a b c');
  assert.equal(view.state.doc.toString(), '- [ ]  a b c');
  assert.equal(rendered(view), ' a b c', 'spaces between words must survive');
});

test('only the separator space is absorbed by the marker', () => {
  const view = makeView('- [ ]   spaced', 0);
  assert.equal(rendered(view), '  spaced', 'exactly one space belongs to the marker');
});

test('the space after a marker is swallowed by its widget', () => {
  // Left as real text it gives the caret somewhere to sit between the bullet
  // and the first character.
  const view = makeView('- ab', 0);
  assert.ok(!rendered(view).includes(' '), `stray space: ${JSON.stringify(rendered(view))}`);
});

test('deeper nesting inside a list still collapses to one jump', () => {
  const view = makeView('- [ ] a\n    - [x] b\n- c', 0);
  const line = view.state.doc.line(2);
  const stops = caretStops(view, line.to, line.from - 1);
  assert.deepEqual(stops.slice(0, 3), [line.to, line.to - 1, line.from],
    `expected one jump to the line start, got ${stops.join(' ')}`);
});

// ── Select line (Cmd+L) ─────────────────────────────────────────────────────

test('Cmd+L selects the whole line the caret is on', () => {
  const doc = '- [ ] first\nplain second\n  - [x] third';
  const view = makeView(doc, 0);
  for (const n of [1, 2, 3]) {
    const line = view.state.doc.line(n);
    view.dispatch({ selection: EditorSelection.single(line.from + 2) });
    COMMANDS.selectLine(view);
    const sel = view.state.selection.main;
    assert.equal(sel.from, line.from, `line ${n} start`);
    assert.ok(sel.to >= line.to, `line ${n} should reach the end of the text`);
  }
});

test('Cmd+L covers the hidden marker, not just the visible text', () => {
  const view = makeView('  - [x] third', 0);
  view.dispatch({ selection: EditorSelection.single(10) });
  COMMANDS.selectLine(view);
  assert.equal(view.state.selection.main.from, 0, 'selection should start at the line start');
});

test('Cmd+L then Cmd+B bolds only the text', () => {
  // The two together are the real workflow: select the line, embolden it.
  const view = makeView('- [ ] CHI Review', 0);
  view.dispatch({ selection: EditorSelection.single(8) });
  COMMANDS.selectLine(view);
  COMMANDS.bold(view);
  assert.equal(view.state.doc.toString(), '- [ ] **CHI Review**');
});

test('Cmd+L leaves the document alone', () => {
  const doc = '- [ ] a\nb';
  const view = makeView(doc, 3);
  COMMANDS.selectLine(view);
  assert.equal(view.state.doc.toString(), doc);
});

// ── Pasting a copied task line ──────────────────────────────────────────────

/** Runs the clipboard filter the way CodeMirror does on paste. */
function filterPaste(view, text) {
  const filters = view.state.facet(EditorView.clipboardInputFilter);
  return filters.reduce((acc, fn) => fn(acc, view.state), text);
}

test('pasting a task onto a task line drops the duplicate marker', () => {
  // Copying a checkbox copies its source. Pasting onto a line that already
  // has one produced `- [ ] - [ ] text`, with the second marker showing as
  // literal characters beside the checkbox.
  const view = makeView('- [ ] ', 6);
  assert.equal(filterPaste(view, '- [ ] mbc inference'), 'mbc inference');
});

test('pasting onto a plain line keeps the marker so a checkbox appears', () => {
  const view = makeView('', 0);
  assert.equal(filterPaste(view, '- [ ] mbc inference'), '- [ ] mbc inference');
});

test('only the first pasted line is stripped', () => {
  // The rest become list items of their own, which is what carries a
  // multi-line copy across intact.
  const view = makeView('- [ ] ', 6);
  assert.equal(
    filterPaste(view, '- [ ] one\n- [ ] two\n- [ ] three'),
    'one\n- [ ] two\n- [ ] three'
  );
});

test('pasting plain text onto a task line is untouched', () => {
  const view = makeView('- [ ] ', 6);
  assert.equal(filterPaste(view, 'just words'), 'just words');
});

test('bullets and numbers are handled the same way', () => {
  for (const [target, pasted, expected] of [
    ['- ', '- item', 'item'],
    ['1. ', '3. item', 'item'],
    ['- [x] ', '- [ ] item', 'item'],
    ['> ', '> quoted', 'quoted'],
  ]) {
    const view = makeView(target, target.length);
    assert.equal(filterPaste(view, pasted), expected, `${JSON.stringify(target)} <- ${JSON.stringify(pasted)}`);
  }
});

// ── Moving a block ──────────────────────────────────────────────────────────

/** Puts the caret at the end of `lineNumber` and runs a move command. */
function move(doc, lineNumber, command) {
  const view = makeView(doc, 0);
  view.dispatch({ selection: EditorSelection.single(view.state.doc.line(lineNumber).to) });
  const handled = command(view);
  return { handled, doc: view.state.doc.toString(), view };
}

test('moving an item carries its nested children', () => {
  // `moveLineUp` shifts one line, which walks a parent out from under its own
  // children and quietly breaks the outline.
  const r = move('- [ ] p\n  - [ ] kid\n- [ ] next', 1, moveBlockDown);
  assert.equal(r.handled, true);
  assert.equal(r.doc, '- [ ] next\n- [ ] p\n  - [ ] kid');
});

test('moving up swaps with the whole sibling block', () => {
  const r = move('- [ ] p\n  - [ ] kid\n- [ ] next', 3, moveBlockUp);
  assert.equal(r.doc, '- [ ] next\n- [ ] p\n  - [ ] kid');
});

test('a child moves past its sibling, not out of its parent', () => {
  const r = move('- [ ] p\n  - [ ] k1\n  - [ ] k2', 3, moveBlockUp);
  assert.equal(r.doc, '- [ ] p\n  - [ ] k2\n  - [ ] k1');
});

test('a child refuses to move above its own parent', () => {
  // Changing the nesting silently would be worse than doing nothing; the user
  // outdents first.
  const r = move('- [ ] p\n  - [ ] kid', 2, moveBlockUp);
  assert.equal(r.handled, false);
  assert.equal(r.doc, '- [ ] p\n  - [ ] kid');
});

test('moving renumbers an ordered list', () => {
  const r = move('1. a\n2. b\n3. c', 2, moveBlockDown);
  assert.equal(r.doc, '1. a\n2. c\n3. b');
});

test('the caret follows the block that moved', () => {
  const r = move('- [ ] a\n- [ ] b', 1, moveBlockDown);
  assert.equal(r.doc, '- [ ] b\n- [ ] a');
  assert.equal(r.view.state.doc.lineAt(r.view.state.selection.main.head).number, 2,
    'caret should still be on the moved line');
});

test('plain paragraphs move too', () => {
  const r = move('one\ntwo', 1, moveBlockDown);
  assert.equal(r.doc, 'two\none');
});

test('moving at the edges does nothing', () => {
  assert.equal(move('- [ ] only', 1, moveBlockUp).handled, false);
  assert.equal(move('- [ ] only', 1, moveBlockDown).handled, false);
});

// ── Report ──────────────────────────────────────────────────────────────────

let failed = 0;
for (const [status, name, message] of results) {
  if (status === 'pass') {
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}\n       ${message}`);
  }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
