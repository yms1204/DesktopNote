# DesktopNote

Floating markdown sticky notes for macOS, with Notion-style live preview.

Built from scratch, using [jaesuny/markdown-sticky-notes](https://github.com/jaesuny/markdown-sticky-notes)
as a reference for the overall shape (native shell + CodeMirror in a web view).

## Build and run

Requires macOS 12+, Swift 5.9+, Node 18+.

```bash
./build-app.sh              # editor bundle + Swift + .app
open build/MDStickyNote.app
```

```bash
./build-app.sh --skip-js    # Swift only, reuse the existing editor bundle
cd editor-web && npm test   # headless editor tests
```

## Typing

Shortcuts fire on the **space**, never before it — `#` and `[]` stay ordinary
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

**The file stays ordinary markdown.** `### Section` is still `### Section` on
disk — only the display changes. The one local dialect is that `|` and `>` are
swapped: other renderers show a toggle as a plain quote.

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

Ordered lists renumber themselves: nesting or moving an item closes the gap it
left behind, in a single undo step.

Pasting a copied task onto a line that is already a task drops the duplicate
marker, so you get the text rather than `- [ ] - [ ] text`. Paste onto a plain
line and the checkbox is created as normal.

## Storage

```
~/Library/Application Support/MDStickyNote/
  notes.json          all notes, human-readable
  backups/            last 40 versions, rotated on every save
```

Writes are atomic. A store that fails to parse is set aside as
`notes.corrupt-<timestamp>.json` rather than overwritten, and the previous
version of a note is always recoverable from `backups/`.

Importing from the old app (reads `com.mdstickynotes.plist`, safe to re-run):

```bash
./migrate-from-old-app.py
```

## Notable differences from the reference

- **Task lists work.** The reference found a task's list marker by assuming it
  sat exactly two characters before `[x]` and read `"- "`, which breaks for
  `* [ ]`, `1. [x]` and `-   [x]`. Its checkbox also returned `false` from
  `ignoreEvent()`, letting the editor steal its own click.
- **One web view per note** instead of a shared one swapped between windows.
  More memory, but it removes the snapshot, focus and content-overwrite races
  that approach needs careful sequencing to avoid.
- **Notes are a JSON file with rolling backups**, not UserDefaults.
- **Editor split by concern** and covered by headless tests.

Design notes, architecture and gotchas: [CLAUDE.md](CLAUDE.md).

## License

MIT
