import { StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { MathWidget } from './widgets.js';

const BLOCK_MATH = /\$\$([\s\S]*?)\$\$/g;
// Inline `$...$`: rejects `$ x$` and `$x $` so prices like "$5 and $6" are
// left alone, and requires the body to be free of newlines and stray `$`.
const INLINE_MATH = /\$(?!\s)((?:[^$\n\\]|\\.)+?)(?<!\s)\$/g;

/**
 * Ranges the math scanner must not touch.
 *
 * Lezer does not treat `$` as special, so math is found by regex. Code spans
 * and fenced blocks are collected from the syntax tree first, otherwise a `$`
 * inside a shell snippet would be swallowed as a formula.
 */
function protectedRanges(state) {
  const ranges = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === 'InlineCode' || node.name === 'FencedCode' || node.name === 'CodeBlock') {
        ranges.push([node.from, node.to]);
      }
    },
  });
  return ranges;
}

const isProtected = (ranges, from, to) =>
  ranges.some(([start, end]) => from < end && to > start);

function buildMathDecorations(state) {
  const text = state.doc.toString();
  const guarded = protectedRanges(state);
  const selection = state.selection.ranges;
  const touches = (from, to) => selection.some((r) => r.from <= to && r.to >= from);

  const ranges = [];
  const consumed = [];

  let match;

  BLOCK_MATH.lastIndex = 0;
  while ((match = BLOCK_MATH.exec(text)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    const formula = match[1].trim();
    if (!formula || isProtected(guarded, from, to)) continue;

    consumed.push([from, to]);
    if (touches(from, to)) continue;

    const startLine = state.doc.lineAt(from);
    const endLine = state.doc.lineAt(to);
    const fillsOwnLines =
      startLine.from === from && endLine.to === to;

    if (fillsOwnLines) {
      // A block replacement must align to whole lines, which is exactly the
      // case where `$$` sits alone on its opening and closing lines.
      ranges.push(
        Decoration.replace({
          widget: new MathWidget(formula, true),
          block: true,
        }).range(from, to)
      );
    } else {
      ranges.push(
        Decoration.replace({ widget: new MathWidget(formula, true) }).range(from, to)
      );
    }
  }

  INLINE_MATH.lastIndex = 0;
  while ((match = INLINE_MATH.exec(text)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    const formula = match[1].trim();
    if (!formula) continue;
    if (isProtected(guarded, from, to)) continue;
    if (isProtected(consumed, from, to)) continue;   // already inside `$$`
    if (touches(from, to)) continue;

    ranges.push(
      Decoration.replace({ widget: new MathWidget(formula, false) }).range(from, to)
    );
  }

  ranges.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  return Decoration.set(ranges, true);
}

/**
 * Math must live in a StateField rather than a ViewPlugin: block replacements
 * span line breaks, which CodeMirror only permits from a field.
 */
export const mathField = StateField.define({
  create(state) {
    return buildMathDecorations(state);
  },

  update(value, tr) {
    // Selection alone changes what is rendered, because the formula under the
    // caret is shown as editable source.
    if (tr.docChanged || tr.selection) return buildMathDecorations(tr.state);
    return value;
  },

  provide: (field) => EditorView.decorations.from(field),
});
