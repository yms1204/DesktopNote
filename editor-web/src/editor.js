// Markdown editor hosted in the note window's WKWebView.
//
// Layout of the rendering pipeline:
//   markdownDecorations (ViewPlugin) - headings, emphasis, lists, checkboxes
//   mathField           (StateField) - KaTeX, needs multi-line replacements
//   markdownHighlight   (HighlightStyle) - token colours inside code blocks

import { EditorState, EditorSelection, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { search, searchKeymap, openSearchPanel, highlightSelectionMatches } from '@codemirror/search';
import 'katex/dist/katex.min.css';

import { post, withoutNotifying, isSuppressed } from './bridge.js';
import { markdownDecorations } from './decorations.js';
import { mathField } from './math.js';
import { editorTheme, highlighting } from './theme.js';
import { findLanguage } from './languages.js';
import { taskBracketInput, pasteMarkerFilter } from './input-rules.js';
import { blockKeymap, moveBlockUp, moveBlockDown } from './lists.js';
import { COMMANDS } from './format.js';
import { toggleExtension } from './toggle.js';

let view = null;

// ─── Formatting keymap ────────────────────────────────────────────────────

// Keys the menu bar also declares. macOS delivers them to the menu first, so
// these bindings only fire when the menu route is unavailable.
const formattingKeymap = [
  { key: 'Mod-b', run: COMMANDS.bold },
  { key: 'Mod-i', run: COMMANDS.italic },
  { key: 'Mod-e', run: COMMANDS.code },
  { key: 'Mod-k', run: COMMANDS.link },
  { key: 'Mod-Shift-x', run: COMMANDS.strikethrough },
  { key: 'Mod-Shift-l', run: COMMANDS.task },
  { key: 'Mod-l', run: COMMANDS.selectLine },
  { key: 'Mod-s', run: () => { post('requestSave'); return true; } },
  // The menu claims Cmd+'+', Cmd+'-' and Cmd+0, but not Cmd+'=' -- which is
  // what Cmd+'+' is on an unshifted keyboard, and what most apps also accept.
  { key: 'Mod-=', run: () => { post('requestZoom', { delta: 1 }); return true; } },
  { key: 'Mod-n', run: () => { post('requestNewNote'); return true; } },
];

// ─── Change reporting ──────────────────────────────────────────────────────

let contentTimer = null;
let selectionTimer = null;

function scheduleContentReport(state) {
  clearTimeout(contentTimer);
  contentTimer = setTimeout(() => {
    post('contentChanged', { content: state.doc.toString() });
  }, 250);
}

function scheduleSelectionReport() {
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(() => {
    if (!view) return;
    post('selectionChanged', {
      cursor: view.state.selection.main.head,
      scrollTop: view.scrollDOM.scrollTop,
    });
  }, 400);
}

// ─── Link handling ─────────────────────────────────────────────────────────

/** Returns the URL of the markdown link containing `pos`, if any. */
function linkAt(state, pos) {
  let found = null;
  syntaxTree(state).iterate({
    from: pos,
    to: pos,
    enter(node) {
      if (node.name !== 'Link' && node.name !== 'URL') return;
      const urlNode = node.name === 'URL' ? node.node : node.node.getChild('URL');
      if (urlNode) found = state.sliceDoc(urlNode.from, urlNode.to);
    },
  });
  return found;
}

// ─── Setup ─────────────────────────────────────────────────────────────────

function createView() {
  const state = EditorState.create({
    doc: '',
    extensions: [
      history(),
      // No `drawSelection()`: it hides the native caret and repaints its own
      // from coordinates measured a frame after the DOM changes. When a
      // widget replaces text -- `[] ` becoming a checkbox -- the caret shows
      // at the old spot for that frame and then snaps. The native caret moves
      // with the DOM, and `caretColor` in the theme already styles it.
      EditorView.lineWrapping,
      taskBracketInput,
      pasteMarkerFilter,

      // Precedence order matters: the formatting keys must win over the
      // defaults, and markdown's Enter/Backspace list handling must win over
      // the plain newline command in defaultKeymap.
      Prec.high(keymap.of(formattingKeymap)),
      // Block editing must beat the markdown keymap that `markdown()` installs
      // itself, and the generic `indentWithTab`, which would insert plain
      // indentation instead of nesting.
      Prec.high(keymap.of(blockKeymap)),
      keymap.of(searchKeymap),
      keymap.of([...historyKeymap, indentWithTab]),
      keymap.of(defaultKeymap),

      // markdownLanguage is the GFM-enabled dialect; the plain commonmark base
      // parses no tables, strikethrough or task markers at all.
      markdown({ base: markdownLanguage, codeLanguages: findLanguage }),

      toggleExtension,
      markdownDecorations,
      mathField,
      highlighting,
      search({ top: true }),
      highlightSelectionMatches(),
      editorTheme,

      EditorView.updateListener.of((update) => {
        if (update.docChanged && !isSuppressed()) scheduleContentReport(update.state);
        if (update.selectionSet && !isSuppressed()) scheduleSelectionReport();
      }),

      EditorView.domEventHandlers({
        mousedown(event, target) {
          // Cmd+click opens links, matching the rest of macOS.
          if (!event.metaKey) return false;
          const pos = target.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos == null) return false;
          const url = linkAt(target.state, pos);
          if (!url) return false;
          event.preventDefault();
          post('openURL', { url });
          return true;
        },
        scroll() {
          scheduleSelectionReport();
          return false;
        },
      }),
    ],
  });

  view = new EditorView({ state, parent: document.getElementById('editor-container') });
}

// ─── API used by Swift ─────────────────────────────────────────────────────

/** Applies the note's paper and accent colours to the CSS custom properties. */
/** Sets the note's text size. Everything else is sized in em, so it follows. */
window.setFontSize = function setFontSize(px) {
  const size = Number(px);
  if (!Number.isFinite(size) || size <= 0) return;
  document.documentElement.style.setProperty('--editor-font-size', size + 'px');
};

window.setTheme = function setTheme(paper, accent) {
  const root = document.documentElement;
  if (paper) root.style.setProperty('--paper', paper);
  if (accent) root.style.setProperty('--accent', accent);
};

/**
 * Installs a note into the editor.
 *
 * Wrapped in `withoutNotifying` so the resulting document change is not echoed
 * back to Swift as a user edit.
 */
window.loadNote = function loadNote(payload) {
  if (!view) return;
  let data;
  try {
    data = typeof payload === 'string' ? JSON.parse(payload) : payload || {};
  } catch (err) {
    console.error('loadNote: bad payload', err);
    return;
  }

  window.setTheme(data.paper, data.accent);
  window.setFontSize(data.fontSize);

  const content = data.content || '';
  const cursor = Math.max(0, Math.min(Number(data.cursor) || 0, content.length));

  clearTimeout(contentTimer);
  withoutNotifying(() => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
      selection: EditorSelection.single(cursor),
    });
  });

  // Scroll after layout, otherwise the target offset does not exist yet.
  requestAnimationFrame(() => {
    view.scrollDOM.scrollTop = Number(data.scrollTop) || 0;
  });
};

window.getContent = function getContent() {
  return view ? view.state.doc.toString() : '';
};

window.focusEditor = function focusEditor() {
  if (view) view.focus();
};

/** Commands the menu bar can invoke, beyond the text-formatting ones. */
const EXTRA_COMMANDS = { moveBlockUp, moveBlockDown };

window.applyFormat = function applyFormat(name) {
  const command = COMMANDS[name] || EXTRA_COMMANDS[name];
  if (!view || !command) return false;
  return command(view);
};

window.openSearch = function openSearch(withReplace) {
  if (!view) return;
  openSearchPanel(view);
  // The panel is created asynchronously, so its class is set on the next frame.
  requestAnimationFrame(() => {
    const panel = document.querySelector('.cm-panel.cm-search');
    if (!panel) return;
    panel.classList.toggle('cm-show-replace', Boolean(withReplace));
    const field = panel.querySelector('input[name=search]');
    if (field) field.select();
  });
};

/** Exposed for debugging from Safari's Web Inspector. */
window.dumpTree = function dumpTree() {
  if (!view) return;
  syntaxTree(view.state).iterate({
    enter(node) {
      console.log(node.name, node.from, node.to, JSON.stringify(view.state.sliceDoc(node.from, node.to).slice(0, 40)));
    },
  });
};

createView();
post('ready');
