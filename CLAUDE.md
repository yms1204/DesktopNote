# CLAUDE.md

Notes for working in this repo.

## Build

```bash
./build-app.sh                # editor bundle -> Swift -> .app
./build-app.sh --skip-js      # Swift only (fast; reuses editor-web/dist)
open build/DesktopNote.app
```

JS-only iteration, without rebuilding Swift:

```bash
cd editor-web && npm run build && \
  cp dist/editor.bundle.js ../build/DesktopNote.app/Contents/Resources/Editor/
```

## Test

```bash
cd editor-web && npm test
```

Headless jsdom tests over the real decoration pipeline. They cover checkbox
rendering and clicking, caret unfolding, and the math/code boundaries. Add a
case here before fixing any rendering bug — most of them are invisible to the
Swift side and tedious to reproduce by hand.

Note: jsdom has no layout, so anything depending on coordinates
(`posAtCoords`, scroll measurement, click-to-caret) cannot be tested this way
and has to be checked in the running app.

## Architecture

Native shell + web editor:

- **Swift/AppKit** — `NSPanel` windows, menus, JSON persistence
- **WKWebView + CodeMirror 6** — the markdown editor, one instance per note
- **Bridge** — `WKScriptMessageHandler` in both directions

### One web view per note

Deliberate. Sharing a single web view across windows and swapping bitmap
snapshots in and out saves memory but costs a long tail of ordering bugs (blank
windows, lost focus, one note's content overwriting another's). Here each `NoteWindowController` owns its web view for its lifetime,
so there is no cross-note state to sequence.

If memory ever matters, the thing to do is close web views for off-screen
windows, not share one.

### Rendering pipeline (editor-web/src)

1. `decorations.js` — `ViewPlugin` walking the Lezer tree; line decorations for
   headings/code/quotes/tables, mark decorations for emphasis, replace
   decorations for checkboxes, bullets, inline code and rules.
2. `math.js` — `StateField`, because block math spans line breaks and only a
   field may produce multi-line replacements.
3. `theme.js` — `EditorView.theme` plus the `HighlightStyle` for code tokens.

### Two marker policies

**Block prefixes** (`### `, `> `, list marks, `- [x] `) are removed outright with
`Decoration.replace({})` and never come back, Notion-style. They are also
registered in `EditorView.atomicRanges`, which is what makes that safe: the
caret steps over them instead of landing in text nobody can see, and Backspace
at the start of the text deletes the whole prefix in one keystroke.

They only disappear once their trailing space exists (`spaceAt`). Without that
check, typing `#` would make the character vanish instantly and the shortcut
would feel broken.

**Emphasis markers** (`**`, `*`, `~~`) are hidden the same way, atomic ranges
included. There is nothing in an asterisk worth reading, and without the atomic
range the caret would park between two invisible ones.

**Links** are the exception and keep the reveal-on-caret model via
`markerClass()` — scoped to the construct, so the caret must be inside *that*
`[text](url)` rather than merely on the same line. The URL is real content, so
hiding it permanently would make it uneditable.

Inline code, math and rules use `selectionTouches` (overlaps *or abuts*), so
putting the caret beside one reveals its source and it can be extended.

Two timing rules keep block shortcuts from firing early, both worth preserving:
`spaceAt()` gates *hiding* the prefix, and the `/^#{1,6}[ \t]/` check in the
`ATXHeading` branch gates *styling* the line. The parser reports `#` as an empty
heading the moment it is typed, so without the second check the font jumps a
keystroke too soon.

### Quotes and toggles (`toggle.js`)

The two markers are swapped from standard markdown: `|` renders as a quote,
`>` as a collapsible toggle.

A toggle is still a real `Blockquote` node — first line is the title, the rest
is the collapsible body. Keeping it a blockquote is what keeps the file valid
markdown, and it means the range to fold comes straight from the tree.

Collapsing reuses `codeFolding()` from `@codemirror/language` rather than a
bespoke StateField: folded ranges then map through edits, survive undo, and
behave correctly with selection and search for free. `toggleRangeAt()` is
shared between the `foldService` and the arrow's click handler so both agree on
what folds.

An empty toggle (no body) gets a hint line telling the user to press Enter.
That hint is a **block** widget, so it is contributed by `toggleHintField`
rather than by the decoration plugin — CodeMirror rejects block decorations
that come from a ViewPlugin. The arrow itself is an inline widget and stays in
the plugin.

The arrow is an SVG path, not a `▶` glyph: text triangles vary in size and
baseline across fonts, and rotating one made the title text shift.

A `Link` with no `URL` child is `[label]`, not a link — the brackets are text
the user typed, so they stay visible (`cm-md-bracket`). Hiding them also left a
zero-width gap at the end of the label that swallowed clicks: the caret landed
between the text and the invisible `]`.

`|` is not a markdown construct, so it is matched per line after the tree walk.
The tree walk collects `reservedLines` (table and fenced-code lines) first,
because **every GFM table row starts with `|`** — without that exclusion the
first row of every table renders as a quote.

### Formatting (`format.js`)

`contentRange()` narrows a selection before emphasis is applied. Without it,
selecting a whole line wraps its block marker too — `**- [ ] text**` — and GFM
will not open emphasis directly before a space, so `** text**` renders as
literal asterisks rather than bold. It skips indent, quote marks, the list
marker, the task box and heading hashes, then trims whitespace.

It deliberately short-circuits on an **empty** selection: trimming a caret
would move it past the line's marker before inserting the pair, teleporting the
cursor. Only real selections get trimmed.

### Block editing (`lists.js`)

`deleteMarkerBackward` is bound to Backspace above the markdown keymap.
`deleteMarkupBackward` replaces a marker with **spaces of the same width** to
hold the text in its column, so deleting a nested `  - [ ] ` leaves eight
spaces and the text floats away from the margin — far enough that markdown
reads it as a code block. This command removes the indent along with the
marker, which is what makes the line an ordinary paragraph and matches what
already happened at the outermost level. It fires only when the caret sits
exactly where the text begins, so mid-text Backspace and line joining are
untouched.

`exitEmptyBlock` is bound to Enter above the markdown keymap. It exists because
`insertNewlineContinueMarkup` does **not** clear an empty list item: given
`- [ ] ` it inserts a blank line and carries the marker to the next line, so
Enter appears to break the line twice and the list can never be escaped. The
command removes the marker at the outermost level and outdents one level when
nested, then returns false for everything else so the markdown command still
handles normal continuation.

`markdown()` installs `markdownKeymap` itself (`addKeymap` defaults to true), so
registering it again explicitly is dead code — the language-scoped copy wins and
the explicit one never fires. Only `Prec.high` bindings beat it.

### Moving blocks (`lists.js`)

`moveBlockUp`/`moveBlockDown` swap an item with its neighbouring **sibling**,
carrying nested children along via `subtreeEnd`. `moveLineUp`/`moveLineDown`
from `@codemirror/commands` shift a single line, which walks a parent out from
under its own children and silently breaks the outline.

Moving a child above its own parent is refused rather than guessed at — that
would change the nesting without being asked. Outdent first.

### Pasting (`input-rules.js`)

`pasteMarkerFilter` strips the marker from the **first** pasted line when the
target line already has one. Copying a task copies its source (`- [ ] text`),
so pasting onto an existing task otherwise yields `- [ ] - [ ] text`. Later
lines keep their markers so a multi-line copy stays a list.

### Lists (`lists.js`)

`Tab`/`Shift-Tab` are bound above both `markdownKeymap` and `indentWithTab`,
and return false when the caret is not in a list so the generic indent command
still gets its turn.

Nesting indents by the *parent's marker width* (`contentColumn`), not by a
fixed unit: CommonMark needs three columns under `1. ` and two under `- `, and
getting it wrong silently produces a sibling instead of a child.

Indent and renumber are composed into one `ChangeSet` (`ChangeSet.compose`)
rather than dispatched separately, so undo reverses the whole operation and no
intermediate numbering is ever displayed. The selection has to be *mapped*
through that change set — outdenting shortens lines, so reusing the old
selection throws "Selection points outside of document".

Two numbering mechanisms, deliberately:

- `renumberSpecs()` rewrites the source on Tab, keeping the file tidy. It keys
  counters by indent width and takes each list's start from its first item, so
  a list deliberately starting at 5 is left alone.
- `orderedLabel()` computes the *displayed* number from the item's position in
  its `OrderedList` node. This is what guarantees the numbers always read
  correctly, including for source the user typed as `1.` `1.` `1.`.

Indentation is rendered by applying a `cm-md-indent-N` line class, with the
leading whitespace swallowed by the marker's own replacement.

**A marker widget's gap belongs inside its own width**, never as a right
margin. CodeMirror positions the caret from the widget's border box, which
excludes margins, so a margin leaves the caret hard against the marker on an
empty item instead of where the text starts. Bullets size their gap with
`width`; the checkbox needs a `.cm-task` wrapper because the `<input>` itself
is the visible box.

**One atomic range per list line**, spanning the line start through the
whitespace after the marker (`markerRange`). Splitting it up breaks arrow keys
in two different ways, both of which read to the user as a space before the
first character: hiding the indent as its own range leaves two adjacent atomic
ranges, so moving left stops twice at the same visual spot; leaving the space
after the marker unhidden leaves a real position the caret can occupy. Depth comes from counting ancestor `ListItem`
nodes (`nestingDepth`) — counting spaces cannot work when bullets nest at two
columns and ordered items at three.

## Gotchas

1. **`ignoreEvent()` on interactive widgets must be `true`** (the default).
   Returning `false` asks CodeMirror to *also* handle the widget's events, which
   places the caret inside the replaced range and unfolds the decoration — a
   checkbox built that way steals its own click.
2. **Never compute a markdown construct's extent from node offsets alone.** The
   list mark and the task box are separate nodes with arbitrary whitespace
   between them; `node.from - 2` only works for `- [x]`. Derive ranges from the
   line text.
3. **`markdownLanguage`, not the default base.** `markdown()` defaults to
   `commonmarkLanguage`, which parses no tables, strikethrough or task markers.
   Use `markdown({ base: markdownLanguage })`.
4. **`StateField` is required for block decorations and for multi-line
   `Decoration.replace`.** A ViewPlugin may contribute neither — block widgets
   fail with "Block decorations may not be specified via plugins". `block: true`
   replace ranges must also align to whole lines. Applies to block math, block
   widgets and the empty-toggle hint alike.
5. **Programmatic document changes must be wrapped in `withoutNotifying`.**
   CodeMirror's update listener fires for them too, and the echo back to Swift
   will overwrite the note that was just loaded.
6. **The menu bar eats shortcuts before the web view sees them.** Any editor
   shortcut also needs a menu item that forwards to JS — that is why `MenuBuilder`
   declares Cmd+B/I/E/K/F and undo/redo.
7. **`WKUserContentController` retains its message handlers.** Registering the
   bridge directly leaks the window; `EditorBridge` registers a weak trampoline
   and `tearDown()` removes it.
8. **Webpack must emit one file.** A web view loading from `file://` cannot fetch
   chunks, so `splitChunks: false` and fonts are inlined as base64.
9. **Static language imports only.** `@codemirror/language-data` resolves grammars
   with dynamic `import()`, which becomes an unreachable chunk.
10. **`codeLanguages` must return a `Language`**, not a `LanguageSupport` —
    use `javascript().language`. Returning the wrapper silently disables
    highlighting.
11. **Never pin the web view to `contentView.topAnchor`.** With
    `fullSizeContentView` the content view runs under the titlebar, so a web
    view pinned to its top covers the titlebar completely — measured as a 0pt
    draggable strip. CodeMirror then takes every click up there as a text
    selection and the window cannot be dragged. Pin to
    `window.contentLayoutGuide.topAnchor`, which tracks the real titlebar
    height. `.utilityWindow` also halves that height (24pt vs 32pt), making an
    already small target smaller.
12. **`NSPanel` refuses key status by default.** `NotePanel` overrides
    `canBecomeKey`/`canBecomeMain`, otherwise the editor never receives
    keystrokes.
13. **GFM needs `- [ ]`, not `- []`.** `input-rules.js` rewrites `[] ` and
    `- [] ` as they are typed; without it the list silently renders as plain
    text. Three things about the trigger, each load-bearing:
    - The **space** commits it, matching `# ` and `- `. Firing on `]` alone
      transformed text under the cursor and made a literal `[]` untypeable.
    - Both patterns are **anchored to the start of the line**, which is what
      keeps `arr[] ` literal — not any check on what follows the caret. An
      earlier version also required the brackets to end the line, which quietly
      broke the main case: typing in front of a line that already had text did
      nothing.
    - Code is excluded via `insideCode()`, tested against `tr.startState` so
      the tree is complete rather than mid-reparse.
14. **`visibleRanges` splits when anything is folded.** `buildDecorations`
    walks the tree once per range, so a node spanning the gap is entered more
    than once — a collapsed toggle drew two arrows this way. Every non-line
    decoration goes through `once()`/`addReplace()` to stay idempotent;
    `addLine` already deduplicates by line.
15. **Swapped quote/toggle markers are a local dialect.** `|` for quote and `>`
    for toggle is not what other markdown renderers do — they will show a
    toggle as a plain quote and a `|` quote as plain text. The file stays valid
    either way, which is the point.
16. **Hiding a range requires making it atomic.** A `Decoration.replace` that the
    caret can still enter produces invisible cursor positions and a Backspace
    that deletes one unseen character at a time. Anything hidden outright goes
    into `atomicRanges` too.

## Debugging

- Swift: `NSLog` output — run the binary directly to see it:
  `./build/DesktopNote.app/Contents/MacOS/DesktopNote`
- JS: `console.log` is forwarded to the Swift log.
- DOM: Safari > Develop > [Mac] > DesktopNote (the web view sets
  `isInspectable = true`).
- Syntax tree: run `dumpTree()` in the Safari console.
