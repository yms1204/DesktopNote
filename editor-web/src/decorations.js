import { Decoration, ViewPlugin, EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { ToggleArrowWidget, toggleRangeAt, isCollapsed, isToggleStart } from './toggle.js';
import {
  TaskCheckboxWidget,
  BulletWidget,
  OrderedWidget,
  InlineCodeWidget,
  RuleWidget,
} from './widgets.js';

/** Matches the leading `- `, `* `, `1. ` of a list item, plus a task box if present. */
const TASK_LINE = /^(\s*)((?:[-*+]|\d+[.)])\s+)\[([ xX])\]/;

/**
 * Describes the task marker on a line, or null if it is not a task item.
 *
 * Derived from the line text rather than from node offsets: the list mark and
 * the `[x]` box are separate syntax nodes with an arbitrary amount of space
 * between them, and they may be indented, so arithmetic on node positions gets
 * `* [ ]`, `1. [x]` and `-   [x]` wrong.
 */
function taskInfo(state, pos) {
  const line = state.doc.lineAt(pos);
  const match = TASK_LINE.exec(line.text);
  if (!match) return null;

  // markFrom is the list mark itself (`-`, `*`, `1.`), NOT the `[` -- the
  // checkbox replaces the mark and the box together, so a bullet is never
  // drawn beside it.
  const markFrom = line.from + match[1].length;
  const boxFrom = markFrom + match[2].length;
  const boxTo = boxFrom + 3;
  return {
    markFrom,
    boxFrom,
    boxTo,
    checked: match[3] !== ' ',
    // Swallow the space after the box so the task text sits flush against it.
    end: state.doc.sliceString(boxTo, boxTo + 1) === ' ' ? boxTo + 1 : boxTo,
  };
}

/**
 * The number to show for an ordered item.
 *
 * Counted from the item's position in its list rather than read from the
 * source, so a list written `1.` `1.` `1.` still displays 1, 2, 3 -- which is
 * also exactly how CommonMark renders it. Nested lists are separate syntax
 * nodes, so each level restarts on its own.
 */
function orderedLabel(state, node, fallback) {
  const list = node.node.parent && node.node.parent.parent;
  if (!list || list.name !== 'OrderedList') return fallback;

  const delim = fallback.slice(-1);
  let start = null;
  let index = 0;

  for (let child = list.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'ListItem') continue;
    const mark = child.getChild('ListMark');
    if (!mark) continue;

    if (start === null) start = parseInt(state.sliceDoc(mark.from, mark.to), 10) || 1;
    if (mark.from === node.from) return String(start + index) + delim;
    index += 1;
  }
  return fallback;
}

/**
 * Nesting level of the list item containing `node`.
 *
 * Counted from the syntax tree rather than from leading spaces: a bullet nests
 * at two columns and an ordered item at three, so indent width alone does not
 * tell you the level.
 */
function nestingDepth(node) {
  let depth = -1;
  for (let n = node.node; n; n = n.parent) if (n.name === 'ListItem') depth += 1;
  return Math.max(0, Math.min(depth, 6));
}

function buildDecorations(view) {
  const { state } = view;
  const ranges = [];
  /**
   * Ranges hidden outright -- block prefixes (`### `, `> `, list marks) and
   * inline emphasis markers. They are also registered as atomic, so arrow keys
   * step over them instead of parking in text nobody can see, and Backspace at
   * the start of a heading removes the whole prefix in one keystroke, the way
   * Notion does.
   */
  const atomic = [];
  const decoratedLines = new Set();
  const selection = state.selection.ranges;

  /**
   * Guards against decorating the same thing twice.
   *
   * The syntax tree is walked once per visible range, and folding a toggle
   * splits the visible ranges in two. A node spanning that gap -- the toggle's
   * own Blockquote, for one -- is therefore entered once per range, which
   * without this check draws two arrows.
   */
  const seen = new Set();
  const once = (key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };

  /** True when a selection overlaps or merely abuts [from, to]. */
  const selectionTouches = (from, to) =>
    selection.some((range) => range.from <= to && range.to >= from);

  const addLine = (pos, cls) => {
    const { from } = state.doc.lineAt(pos);
    const key = from + ':' + cls;
    if (decoratedLines.has(key)) return;
    decoratedLines.add(key);
    ranges.push(Decoration.line({ class: cls }).range(from));
  };

  const addMark = (from, to, cls) => {
    if (to <= from) return;
    if (!once(`mark:${from}:${to}:${cls}`)) return;
    ranges.push(Decoration.mark({ class: cls }).range(from, to));
  };

  /** Adds a replace decoration, optionally atomic, at most once per range. */
  const addReplace = (key, from, to, spec, { atomic: isAtomic = false } = {}) => {
    if (to < from) return;
    if (!once(`${key}:${from}:${to}`)) return;
    const deco = Decoration.replace(spec);
    ranges.push(deco.range(from, to));
    if (isAtomic) atomic.push(deco.range(from, to));
  };

  /** Removes a range from view and makes it behave as a single unit. */
  const hide = (from, to) => {
    if (to <= from) return;
    addReplace('hide', from, to, {}, { atomic: true });
  };

  /**
   * Indents a list line by level.
   *
   * Literal spaces in a proportional font make nesting almost invisible and
   * leave wrapped continuation lines hanging at the left margin, so the indent
   * is drawn as line padding instead. The spaces themselves are swallowed by
   * the marker's own replacement -- see `markerRange`.
   */
  const indentListLine = (pos, depth) => {
    if (depth > 0) addLine(state.doc.lineAt(pos).from, 'cm-md-indent-' + depth);
  };

  /**
   * The span a list marker's widget should replace: from the start of the
   * line through the whitespace that follows the marker.
   *
   * Covering the whole prefix as one range is what keeps arrow keys honest.
   * Hiding the indent separately left two adjacent atomic ranges, so moving
   * left out of the text stopped twice at the same visual spot; leaving the
   * space after the marker unhidden left a real space the caret could sit in,
   * which reads as a gap before the first character.
   */
  const markerRange = (markerTo) => {
    // Exactly one space: that is the separator between the marker and the
    // text. Consuming every following space swallowed the ones the user types,
    // so pressing space on a task line appeared to do nothing at all.
    const next = state.doc.sliceString(markerTo, markerTo + 1);
    return /[ \t]/.test(next) ? markerTo + 1 : markerTo;
  };

  /** True when the character at `pos` is a space or tab. */
  const spaceAt = (pos) => /[ \t]/.test(state.doc.sliceString(pos, pos + 1));

  /**
   * Reveals an inline construct's markers only while the caret is inside that
   * construct -- not merely somewhere on the same line. Keeps `**bold**`
   * editable without showing every marker on the line at once.
   */
  const markerClass = (node) => {
    const parent = node.node.parent;
    const inside = parent
      ? selectionTouches(parent.from, parent.to)
      : selectionTouches(node.from, node.to);
    return inside ? 'cm-md-marker cm-md-marker-visible' : 'cm-md-marker';
  };

  // Lines where a leading `|` belongs to something else -- a table row or a
  // fenced code block -- and must not be mistaken for a quote.
  const reservedLines = new Set();

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        const name = node.name;

        // ── Headings ────────────────────────────────────────────────
        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          // `#` alone is a valid empty heading in CommonMark, so the parser
          // reports one the instant the character is typed. Styling it that
          // early makes the font jump before the user has committed to a
          // heading -- wait for the space, like Notion does.
          if (!/^#{1,6}[ \t]/.test(state.doc.lineAt(node.from).text)) return;
          addLine(node.from, 'cm-md-h' + heading[1]);
          return;
        }

        switch (name) {
          case 'HeaderMark': {
            const line = state.doc.lineAt(node.from);

            if (node.from !== line.from) {
              // Trailing `#` of a closed ATX heading.
              addMark(node.from, node.to, 'cm-md-marker cm-md-marker-trailing');
              break;
            }

            // Only disappear once the space is typed. Until then the hashes
            // are left completely undecorated, so they read as the ordinary
            // characters they still are.
            if (!spaceAt(node.to)) break;
            hide(node.from, node.to + 1);
            break;
          }

          // ── Emphasis ──────────────────────────────────────────────
          case 'StrongEmphasis':
            addMark(node.from, node.to, 'cm-md-strong');
            break;
          case 'Emphasis':
            addMark(node.from, node.to, 'cm-md-em');
            break;
          case 'Strikethrough':
            addMark(node.from, node.to, 'cm-md-strike');
            break;
          // Hidden outright rather than revealed under the caret: there is
          // nothing in `**` worth reading, and an atomic range keeps the caret
          // from parking between two invisible asterisks.
          case 'EmphasisMark':
          case 'StrikethroughMark':
            hide(node.from, node.to);
            break;

          // Links keep the reveal-on-caret behaviour -- unlike `**`, the URL
          // is real content that has to be visible to be edited.
          case 'LinkMark': {
            // `[label]` with no target is not really a link: the brackets are
            // text the user typed, so they stay on screen. Hiding them would
            // also leave a zero-width gap at the end that swallows clicks --
            // the caret lands between the text and the invisible `]`.
            const link = node.node.parent;
            if (link && link.name === 'Link' && !link.getChild('URL')) {
              addMark(node.from, node.to, 'cm-md-bracket');
              break;
            }
            addMark(node.from, node.to, markerClass(node));
            break;
          }

          case 'QuoteMark': {
            // Left completely undecorated until the space, so a lone `>` reads
            // as the ordinary character it still is.
            if (!spaceAt(node.to)) break;
            hide(node.from, node.to + 1);
            break;
          }

          // ── Inline code ───────────────────────────────────────────
          case 'InlineCode': {
            if (selectionTouches(node.from, node.to)) {
              addMark(node.from, node.to, 'cm-inline-code-raw');
              break;
            }
            const text = state.sliceDoc(node.from, node.to).replace(/^`+|`+$/g, '');
            addReplace('code', node.from, node.to, { widget: new InlineCodeWidget(text) });
            break;
          }

          // ── Fenced code ───────────────────────────────────────────
          case 'FencedCode': {
            const first = state.doc.lineAt(node.from).number;
            const last = state.doc.lineAt(node.to).number;
            for (let n = first; n <= last; n += 1) {
              const line = state.doc.line(n);
              addLine(line.from, 'cm-md-code-line');
              if (n === first) addLine(line.from, 'cm-md-code-first');
              if (n === last) addLine(line.from, 'cm-md-code-last');
              reservedLines.add(n);
            }
            break;
          }
          case 'CodeMark':
          case 'CodeInfo':
            addMark(node.from, node.to, 'cm-md-code-fence');
            break;

          // ── Toggle (`> `) ─────────────────────────────────────────
          case 'Blockquote': {
            const first = state.doc.lineAt(node.from);

            // Wait for the space, exactly as headings do.
            if (!isToggleStart(state, first.from)) break;

            const last = state.doc.lineAt(node.to);
            addLine(first.from, 'cm-md-toggle-title');
            for (let n = first.number + 1; n <= last.number; n += 1) {
              addLine(state.doc.line(n).from, 'cm-md-toggle-body');
            }

            const foldable = toggleRangeAt(state, first.from) !== null;

            if (once(`toggle:${first.from}`)) {
              ranges.push(
                Decoration.widget({
                  widget: new ToggleArrowWidget(isCollapsed(state, first.from), foldable),
                  side: -1,
                }).range(first.from)
              );
            }
            // The empty-toggle hint is a block widget, so it is contributed
            // by a StateField in toggle.js rather than from here.
            break;
          }

          // ── Links ─────────────────────────────────────────────────
          case 'URL':
            addMark(node.from, node.to, markerClass(node) + ' cm-md-url');
            break;
          case 'Link':
            addMark(node.from, node.to, 'cm-md-link');
            break;

          // ── Horizontal rule ───────────────────────────────────────
          case 'HorizontalRule': {
            if (selectionTouches(node.from, node.to)) break;
            addReplace('rule', node.from, node.to, { widget: new RuleWidget() });
            break;
          }

          // ── Lists ─────────────────────────────────────────────────
          case 'ListMark': {
            // A task item's mark is drawn together with its checkbox below.
            const task = taskInfo(state, node.from);
            if (task && task.markFrom === node.from) break;

            // `-` on its own is still being typed; wait for the space.
            if (!spaceAt(node.to)) {
              addMark(node.from, node.to, 'cm-md-list-mark-raw');
              break;
            }

            const depth = nestingDepth(node);
            indentListLine(node.from, depth);

            const text = state.sliceDoc(node.from, node.to);
            const widget = /^\d/.test(text)
              ? new OrderedWidget(orderedLabel(state, node, text))
              : new BulletWidget(depth);
            addReplace(
              'list',
              state.doc.lineAt(node.from).from,
              markerRange(node.to),
              { widget },
              { atomic: true }
            );
            break;
          }

          case 'TaskMarker': {
            const task = taskInfo(state, node.from);
            if (!task) break;

            indentListLine(node.from, nestingDepth(node));

            // Always drawn as a checkbox: there is nothing in `- [x]` worth
            // editing as text, and the atomic range keeps Backspace sensible.
            addReplace(
              'task',
              state.doc.lineAt(node.from).from,
              markerRange(task.boxTo),
              { widget: new TaskCheckboxWidget(task.checked) },
              { atomic: true }
            );
            if (task.checked) addLine(node.from, 'cm-md-task-done');
            break;
          }

          // ── Tables ────────────────────────────────────────────────
          case 'Table': {
            const first = state.doc.lineAt(node.from).number;
            const last = state.doc.lineAt(node.to).number;
            for (let n = first; n <= last; n += 1) {
              addLine(state.doc.line(n).from, 'cm-md-table');
              reservedLines.add(n);
            }
            break;
          }
          case 'TableHeader':
            addLine(node.from, 'cm-md-table-header');
            break;
          case 'TableDelimiter':
            addMark(node.from, node.to, 'cm-md-table-delim');
            break;

          default:
            break;
        }
      },
    });
  }

  // ── Quotes (`| `) ─────────────────────────────────────────────────────────
  //
  // Not a markdown construct, so it is matched on the line rather than taken
  // from the tree. A leading `|` is also how GFM writes a table row, which is
  // why table and code lines are excluded above -- otherwise the first row of
  // every table would render as a quote.
  for (const { from, to } of view.visibleRanges) {
    const firstLine = state.doc.lineAt(from).number;
    const lastLine = state.doc.lineAt(to).number;

    for (let n = firstLine; n <= lastLine; n += 1) {
      if (reservedLines.has(n)) continue;

      const line = state.doc.line(n);
      const match = /^([ \t]*)\|([ \t]?)/.exec(line.text);
      if (!match) continue;

      addLine(line.from, 'cm-md-quote');
      hide(line.from + match[1].length, line.from + match[1].length + 1 + match[2].length);
    }
  }

  return {
    decorations: Decoration.set(ranges, true),
    atomic: Decoration.set(atomic, true),
  };
}

export const markdownDecorations = ViewPlugin.fromClass(
  class {
    constructor(view) {
      const built = buildDecorations(view);
      this.decorations = built.decorations;
      this.atomic = built.atomic;
    }

    update(update) {
      // The syntax tree is parsed incrementally, so decorations must also be
      // rebuilt when parsing advances without the document changing.
      const treeChanged = syntaxTree(update.state) !== syntaxTree(update.startState);
      if (update.docChanged || update.viewportChanged || update.selectionSet || treeChanged) {
        const built = buildDecorations(update.view);
        this.decorations = built.decorations;
        this.atomic = built.atomic;
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,

    // Hidden block prefixes behave as single units for cursor motion and
    // deletion, so the caret never lands inside text it cannot see.
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),

    // Clicking a rendered checkbox must toggle it even when the click lands on
    // padding around the input rather than the input itself.
    eventHandlers: {
      mousedown(event) {
        const box = event.target.closest && event.target.closest('.cm-task-checkbox');
        if (!box) return false;
        event.preventDefault();
        return true;
      },
    },
  }
);
