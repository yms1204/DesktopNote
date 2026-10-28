# DesktopNote

Floating markdown notes for the macOS desktop, with Notion-style live preview.

Each note is its own small window that stays on top of your work. You write
plain markdown, and the formatting shows up right away: headings, checkboxes,
toggles, code, math. The file on disk is still ordinary markdown.

## Build and run

Requires macOS 12+, Swift 5.9+, Node 18+.

```bash
./build-app.sh              # editor bundle + Swift + .app
open build/DesktopNote.app
```

```bash
./build-app.sh --skip-js    # Swift only, reuse the existing editor bundle
cd editor-web && npm test   # headless editor tests
```

## Typing

Shortcuts fire on the **space**, never before it, so `#` and `[]` stay ordinary
text until you commit them.

| You type | You get |
|----------|---------|
| `# ` … `###### ` | Heading |
| `- ` / `* ` / `1. ` | Bullet / numbered item |
| `[] ` | Checkbox (no bullet needed first) |
| `\| ` | Quote, with a left bar |
| `> ` | Toggle — click the triangle to collapse it |
| `**bold**`, `*italic*`, `~~strike~~`, `` `code` `` | Inline formatting |
| `$x^2$`, `$$...$$` | KaTeX math |

Markers are hidden once rendered and the caret steps over them, so Backspace at
the start of a heading turns it back into a paragraph in one keystroke. Links
are the exception: `[text](url)` shows its URL while the caret is inside it.

`### Section` is still `### Section` on disk; only the display changes. The one
local dialect is that `|` and `>` are swapped, so other markdown renderers show
a toggle as a plain quote.

## Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+N` / `Cmd+W` | New note / close note (asks before discarding) |
| `Cmd+B` / `Cmd+I` / `Cmd+E` / `Cmd+K` | Bold / italic / code / link |
| `Cmd+Shift+X` / `Cmd+Shift+L` | Strikethrough / toggle task |
| `Cmd+L` | Select the current line |
| `Ctrl+Cmd+↑` / `↓` | Move the current item (and anything nested under it) |
| `Tab` / `Shift+Tab` | Nest / un-nest a list item (children come along) |
| `Cmd+` `+` / `-` / `0` | Zoom in / out / reset, per note |
| `Cmd+F` / `Cmd+Shift+F` | Find / find and replace |
| `Cmd+` `` ` `` | Cycle through notes |
| `Cmd+Click` | Open a link |

Opacity, colour and pin live in each note's title bar.

Ordered lists renumber themselves. When you nest or move an item, the gap it
leaves is closed, and one undo reverts the whole change.

If you paste a copied task onto a line that is already a task, the duplicate
marker is dropped, so you get the text instead of `- [ ] - [ ] text`.

## Storage

```
~/Library/Application Support/DesktopNote/
  notes.json          all notes, human-readable
  backups/            last 40 versions, rotated on every save
```

Writes are atomic. If the store fails to parse, it is kept as
`notes.corrupt-<timestamp>.json` instead of being overwritten. Earlier versions
of every note can be recovered from `backups/`.

## How it's built

- **Swift / AppKit** for the windows, menus and storage.
- **CodeMirror 6 in a WKWebView** for the editor, one web view per note, so
  notes never share editor state.
- **Headless tests** run against the real rendering pipeline.

Design notes, architecture and gotchas are in [CLAUDE.md](CLAUDE.md).
