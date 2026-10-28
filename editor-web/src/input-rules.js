import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { MARKER_PREFIX } from './lists.js';

/**
 * True when `pos` sits in code, where `[]` is a literal and not a shortcut.
 *
 * Checked against the state *before* the change: the enclosing code block
 * already existed, and the pre-change tree is complete rather than mid-reparse.
 */
function insideCode(state, pos) {
  const at = Math.max(0, Math.min(pos, state.doc.length));
  for (let node = syntaxTree(state).resolveInner(at, -1); node; node = node.parent) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'InlineCode') {
      return true;
    }
  }
  return false;
}

/**
 * Turns `[] ` into a real task item as it is typed or pasted.
 *
 * GFM only recognises a task box with a space between the brackets, so plain
 * `[]` parses as ordinary text and renders no checkbox at all. That is an easy
 * mistake to make and a baffling one to debug, because the source still looks
 * correct.
 *
 * The **space** is what commits the shortcut, matching `# ` and `- `: `[]` on
 * its own is left alone, so typing a literal pair of brackets is still
 * possible and nothing transforms under the cursor mid-word.
 *
 *   `[] `    ->  `- [ ] `   at the start of a line, the way Notion creates a
 *                           to-do block without needing a bullet first
 *   `- [] `  ->  `- [ ] `   the box is completed in place
 *
 * Implemented as a transaction filter rather than an input handler so it also
 * catches pasted text, and so it can be tested without synthesising DOM input
 * events.
 */
export const taskBracketInput = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent('input')) return tr;

  const head = tr.newSelection.main.head;
  const line = tr.newDoc.lineAt(head);
  const column = head - line.from;
  const before = line.text.slice(0, column);

  // Both patterns are anchored to the start of the line, which is what keeps
  // `arr[] ` in the middle of a sentence from sprouting a checkbox. Nothing is
  // checked about the text *after* the caret, so typing `[] ` in front of a
  // line that already has words converts that line -- the same way typing
  // `### ` or `- ` in front of it does.
  const withList = /^(\s*(?:[-*+]|\d+[.)])\s+)\[\] $/.exec(before);
  const bare = withList ? null : /^(\s*)\[\] $/.exec(before);
  const match = withList || bare;
  if (!match) return tr;

  const bracketFrom = line.from + match[1].length;

  // `[]string{...}` and friends are code, not a checkbox.
  if (insideCode(tr.startState, bracketFrom)) return tr;

  // A space that was already on the line is absorbed, so converting in front
  // of ` todo` yields `- [ ] todo` rather than leaving a double gap.
  const alreadySpaced = line.text[column] === ' ' ? 1 : 0;

  return [
    tr,
    {
      changes: {
        from: bracketFrom,
        to: bracketFrom + 3 + alreadySpaced,   // covers "[] "
        insert: withList ? '[ ] ' : '- [ ] ',
      },
      sequential: true,
    },
  ];
});

/**
 * Drops a pasted line's own marker when the line it lands on already has one.
 *
 * Copying a task copies its source, `- [ ] text`. Pasting that onto a line
 * that is already a task used to produce `- [ ] - [ ] text`, with the second
 * marker showing as literal characters beside the checkbox.
 *
 * Only the first pasted line is touched -- later lines become list items of
 * their own, which is what carries a multi-line copy across intact. A paste
 * onto a plain line keeps its markers too, so the checkbox is created there.
 */
export const pasteMarkerFilter = EditorView.clipboardInputFilter.of((text, state) => {
  const line = state.doc.lineAt(state.selection.main.from);
  if (!MARKER_PREFIX.test(line.text)) return text;

  const lines = text.split('\n');
  const stripped = lines[0].replace(MARKER_PREFIX, '');
  if (stripped === lines[0]) return text;

  lines[0] = stripped;
  return lines.join('\n');
});
