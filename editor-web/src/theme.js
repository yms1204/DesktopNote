import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace';
const SANS = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif';

export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'var(--editor-font-size, 14px)',
    color: 'var(--ink)',
    backgroundColor: 'transparent',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: SANS,
    lineHeight: '1.65',
  },
  '.cm-content': {
    fontFamily: SANS,
    // No titlebar allowance needed: the web view now starts below it.
    padding: '14px 18px 24px 18px',
    caretColor: 'var(--accent)',
    '-webkit-user-select': 'text',
    userSelect: 'text',
  },
  '.cm-line': { padding: '0 2px' },
  '.cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 24%, transparent)',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 16%, transparent)',
    borderRadius: '2px',
  },

  // Markers collapse to nothing unless the caret is inside their own inline
  // construct. Block prefixes (`### `, `> `, list marks) are removed outright
  // by a replace decoration instead and never appear here.
  '.cm-md-marker': {
    fontSize: '0',
    opacity: '0',
  },
  '.cm-md-marker-visible': {
    fontSize: 'inherit',
    opacity: '0.34',
  },
  '.cm-md-marker-trailing': { color: 'inherit !important' },

  '.cm-md-h1': { fontSize: '1.75em', fontWeight: '700', lineHeight: '1.3', padding: '6px 2px 2px' },
  '.cm-md-h2': { fontSize: '1.45em', fontWeight: '700', lineHeight: '1.3', padding: '5px 2px 2px' },
  '.cm-md-h3': { fontSize: '1.22em', fontWeight: '650', lineHeight: '1.35', padding: '4px 2px 2px' },
  '.cm-md-h4': { fontSize: '1.08em', fontWeight: '650' },
  '.cm-md-h5': { fontSize: '1em', fontWeight: '650', opacity: '0.9' },
  '.cm-md-h6': { fontSize: '0.94em', fontWeight: '650', opacity: '0.75' },

  '.cm-md-strong': { fontWeight: '700' },
  '.cm-md-em': { fontStyle: 'italic' },
  '.cm-md-strike': { textDecoration: 'line-through', opacity: '0.6' },
  '.cm-md-link': { color: 'var(--accent)', textDecoration: 'underline', textUnderlineOffset: '2px' },
  // Brackets of a target-less `[label]`. Dimmed, but never hidden -- see the
  // LinkMark case in decorations.js.
  '.cm-md-bracket': { opacity: '0.45' },
  '.cm-md-url': { color: 'var(--accent)' },

  '.cm-inline-code, .cm-inline-code-raw': {
    fontFamily: MONO,
    fontSize: '0.9em',
    padding: '1px 5px',
    borderRadius: '4px',
    backgroundColor: 'rgba(0, 0, 0, 0.07)',
  },
  '.cm-md-code-line': {
    fontFamily: MONO,
    fontSize: '0.88em',
    backgroundColor: 'rgba(0, 0, 0, 0.055)',
    padding: '0 10px',
  },
  '.cm-md-code-first': { paddingTop: '6px', borderRadius: '6px 6px 0 0' },
  '.cm-md-code-last': { paddingBottom: '6px', borderRadius: '0 0 6px 6px' },
  '.cm-md-code-fence': { opacity: '0.4', fontSize: '0.85em' },

  // Quote (`| `). The bar replaces the marker, which is hidden.
  '.cm-md-quote': {
    borderLeft: '3px solid color-mix(in srgb, var(--accent) 50%, transparent)',
    paddingLeft: '12px',
    opacity: '0.85',
    fontStyle: 'italic',
  },

  // ── Toggle (`> `) ───────────────────────────────────────────────────
  '.cm-md-toggle-title': { fontWeight: '600' },
  '.cm-md-toggle-body': {
    // Same 18px as the arrow's width, so the body sits under the title text.
    paddingLeft: '18px',
    opacity: '0.92',
  },
  '.cm-toggle-arrow': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    // Matches the body indent, so the title text and the body line up.
    width: '18px',
    height: '1.2em',
    marginLeft: '-2px',
    verticalAlign: 'text-bottom',
    color: 'var(--ink)',
    opacity: '0.55',
    cursor: 'pointer',
    userSelect: 'none',
    // Rotated rather than swapped for a second glyph, so the two states share
    // a width and the title text never shifts as it opens.
    transform: 'rotate(90deg)',
    transformOrigin: '50% 50%',
    transition: 'transform 140ms ease, opacity 140ms ease',
  },
  '.cm-toggle-arrow svg': { width: '10px', height: '10px', fill: 'currentColor', display: 'block' },
  '.cm-toggle-arrow.cm-toggle-collapsed': { transform: 'rotate(0deg)' },
  '.cm-toggle-arrow:hover': { opacity: '1' },
  '.cm-toggle-arrow.cm-toggle-inert': { opacity: '0.25', cursor: 'default' },

  // Hint shown inside an empty toggle.
  '.cm-toggle-hint': {
    paddingLeft: '18px',
    opacity: '0.42',
    fontStyle: 'normal',
    pointerEvents: 'none',
    userSelect: 'none',
  },
  '.cm-toggle-placeholder': {
    padding: '0 6px',
    margin: '0 4px',
    borderRadius: '4px',
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
    color: 'inherit',
    opacity: '0.6',
    cursor: 'pointer',
  },
  '.cm-toggle-placeholder:hover': { backgroundColor: 'rgba(0, 0, 0, 0.14)' },

  // Widths below stand in for the marker *and* the space after it, which the
  // widget now replaces outright.
  '.cm-bullet': {
    color: 'var(--accent)',
    fontWeight: '700',
    display: 'inline-block',
    width: '1.3em',
  },
  '.cm-ordered': {
    color: 'var(--accent)',
    fontWeight: '600',
    // Right-aligned in a fixed box so "9." and "10." share a text margin.
    display: 'inline-block',
    minWidth: '1.6em',
    marginRight: '0.3em',
  },

  // Nesting steps. Applied to the whole line, so wrapped continuation text
  // stays aligned under the item instead of falling back to the margin.
  '.cm-md-indent-1': { paddingLeft: '20px' },
  '.cm-md-indent-2': { paddingLeft: '40px' },
  '.cm-md-indent-3': { paddingLeft: '60px' },
  '.cm-md-indent-4': { paddingLeft: '80px' },
  '.cm-md-indent-5': { paddingLeft: '100px' },
  '.cm-md-indent-6': { paddingLeft: '120px' },
  '.cm-md-list-mark-raw': { color: 'var(--accent)', opacity: '0.55' },

  // Matches the bullet: the gap after the marker is part of the widget's own
  // width, so the caret after it lands where the text starts.
  '.cm-task': {
    display: 'inline-block',
    width: '1.45em',
    lineHeight: '1',
  },
  '.cm-task-checkbox': {
    appearance: 'none',
    '-webkit-appearance': 'none',
    width: '14px',
    height: '14px',
    margin: '0',
    verticalAlign: '-2px',
    border: '1.5px solid color-mix(in srgb, var(--accent) 70%, transparent)',
    borderRadius: '4px',
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    cursor: 'pointer',
    position: 'relative',
    transition: 'background-color 120ms ease, border-color 120ms ease',
  },
  '.cm-task-checkbox:hover': {
    borderColor: 'var(--accent)',
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
  },
  '.cm-task-checkbox:checked': {
    backgroundColor: 'var(--accent)',
    borderColor: 'var(--accent)',
  },
  '.cm-task-checkbox:checked::after': {
    content: '""',
    position: 'absolute',
    left: '4px',
    top: '1px',
    width: '3px',
    height: '7px',
    border: 'solid #fff',
    borderWidth: '0 2px 2px 0',
    transform: 'rotate(43deg)',
  },
  '.cm-md-task-done': { opacity: '0.55', textDecoration: 'line-through' },

  '.cm-rule': {
    display: 'inline-block',
    width: '100%',
    height: '1px',
    verticalAlign: 'middle',
    backgroundColor: 'color-mix(in srgb, var(--ink) 25%, transparent)',
  },

  '.cm-md-table': { fontFamily: MONO, fontSize: '0.86em' },
  '.cm-md-table-header': { fontWeight: '700' },
  '.cm-md-table-delim': { opacity: '0.35' },

  '.cm-math-block': {
    display: 'block',
    padding: '10px 4px',
    textAlign: 'center',
    overflowX: 'auto',
  },
  '.cm-math-inline': { padding: '0 2px' },
  '.cm-math-error': { color: '#b3261e', fontFamily: MONO, fontSize: '0.88em' },

  '.cm-panels': {
    backgroundColor: 'color-mix(in srgb, var(--paper) 88%, #000)',
    color: 'var(--ink)',
    border: 'none',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid rgba(0,0,0,0.12)' },
  '.cm-panel.cm-search': {
    padding: '6px 8px',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
    fontFamily: SANS,
    fontSize: '12px',
  },
  '.cm-panel.cm-search br': { display: 'none' },
  '.cm-panel.cm-search input[type=text]': {
    fontFamily: SANS,
    fontSize: '12px',
    padding: '3px 7px',
    borderRadius: '5px',
    border: '1px solid rgba(0,0,0,0.18)',
    backgroundColor: 'rgba(255,255,255,0.75)',
    color: 'var(--ink)',
    minWidth: '120px',
  },
  '.cm-panel.cm-search button': {
    fontFamily: SANS,
    fontSize: '11px',
    padding: '3px 8px',
    borderRadius: '5px',
    border: '1px solid rgba(0,0,0,0.15)',
    backgroundColor: 'rgba(255,255,255,0.6)',
    color: 'inherit',
    cursor: 'pointer',
  },
  '.cm-panel.cm-search button:hover': { backgroundColor: 'rgba(255,255,255,0.95)' },
  '.cm-panel.cm-search label': { color: 'inherit', opacity: '0.8', display: 'inline-flex', alignItems: 'center', gap: '3px' },
  '.cm-panel.cm-search input[name=replace], .cm-panel.cm-search button[name=replace], .cm-panel.cm-search button[name=replaceAll]': {
    display: 'none',
  },
  '.cm-panel.cm-search.cm-show-replace input[name=replace], .cm-panel.cm-search.cm-show-replace button[name=replace], .cm-panel.cm-search.cm-show-replace button[name=replaceAll]': {
    display: 'inline-block',
  },
});

/** Markdown token colours that complement the decoration classes above. */
export const markdownHighlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--accent)' },
  { tag: t.monospace, fontFamily: MONO },

  { tag: t.keyword, color: '#9b2393' },
  { tag: [t.string, t.special(t.string)], color: '#c41a16' },
  { tag: [t.number, t.bool, t.null], color: '#1c00cf' },
  { tag: t.comment, color: '#5d6c79', fontStyle: 'italic' },
  { tag: [t.definition(t.variableName), t.function(t.variableName)], color: '#326d74' },
  { tag: [t.typeName, t.className], color: '#3f6e75' },
  { tag: t.operator, color: '#5c5c5c' },
  { tag: t.propertyName, color: '#4b21b0' },
  { tag: t.invalid, color: '#b3261e' },
]);

export const highlighting = syntaxHighlighting(markdownHighlight);
