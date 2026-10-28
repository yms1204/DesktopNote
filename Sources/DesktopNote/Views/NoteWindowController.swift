import AppKit
import WebKit

protocol NoteWindowControllerDelegate: AnyObject {
    func noteWindowDidRequestNewNote(_ controller: NoteWindowController)
    func noteWindowDidClose(_ controller: NoteWindowController)
    func noteWindowDidRequestDelete(_ controller: NoteWindowController)
}

/// A single floating note window, owning its own `WKWebView`.
///
/// One web view per note (rather than one shared view reparented between
/// windows) costs more memory but removes the entire class of snapshot,
/// focus-restore and cross-note content-overwrite races that a shared view
/// requires careful sequencing to avoid.
final class NoteWindowController: NSWindowController {

    let noteId: UUID
    weak var noteDelegate: NoteWindowControllerDelegate?

    private unowned let store: NoteStore
    private let bridge = EditorBridge()
    private var webView: WKWebView!

    /// Editor content is only pushed into the web view once it reports `ready`.
    private var isEditorReady = false
    private var pendingLoad: Note?

    private var colorButton: NSButton!
    private var pinButton: NSButton!
    private var opacitySlider: NSSlider!

    private static let titlebarHeight: CGFloat = 28

    // MARK: - Init

    init(note: Note, store: NoteStore) {
        self.noteId = note.id
        self.store = store

        let panel = NotePanel(
            contentRect: NSRect(origin: note.position, size: note.size),
            styleMask: [.titled, .closable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        super.init(window: panel)

        configureWindow(panel, note: note)
        buildWebView(note: note)
        buildTitlebarAccessory(note: note)

        panel.delegate = self
        pendingLoad = note
        loadEditor()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    // MARK: - Window setup

    private func configureWindow(_ panel: NSPanel, note: Note) {
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        // The titlebar strip left bare above the web view is window background,
        // so this makes that whole strip draggable, not just the middle gap
        // between the traffic lights and the accessory controls.
        panel.isMovableByWindowBackground = true
        panel.hidesOnDeactivate = false
        panel.isFloatingPanel = false
        panel.becomesKeyOnlyIfNeeded = false
        // Wide enough that the traffic lights and the accessory controls still
        // leave a comfortable stretch of titlebar to grab and drag.
        panel.minSize = NSSize(width: 320, height: 200)
        panel.backgroundColor = NoteColor.from(note.colorTheme).color
        panel.alphaValue = CGFloat(note.opacity)
        panel.isReleasedWhenClosed = false
        panel.title = note.displayTitle
        panel.animationBehavior = .utilityWindow
        applyAlwaysOnTop(note.alwaysOnTop, to: panel)

        // A note restored off-screen (external display unplugged) must be
        // pulled back onto a visible screen rather than becoming unreachable.
        if !NSScreen.screens.contains(where: { $0.visibleFrame.intersects(panel.frame) }) {
            panel.center()
        }
    }

    private func applyAlwaysOnTop(_ on: Bool, to panel: NSWindow) {
        panel.level = on ? .floating : .normal
        panel.collectionBehavior = on
            ? [.canJoinAllSpaces, .fullScreenAuxiliary]
            : [.managed, .participatesInCycle]
    }

    private func buildWebView(note: Note) {
        let config = WKWebViewConfiguration()
        bridge.delegate = self
        bridge.install(on: config.userContentController)
        config.userContentController.addUserScript(Self.consoleForwardingScript())
        if #available(macOS 13.3, *) { config.preferences.isElementFullscreenEnabled = false }

        webView = WKWebView(frame: .zero, configuration: config)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.setValue(false, forKey: "drawsBackground")
        webView.allowsBackForwardNavigationGestures = false
        if #available(macOS 13.3, *) { webView.isInspectable = true }

        guard let window, let contentView = window.contentView else { return }
        contentView.addSubview(webView)

        // The web view stops below the titlebar rather than filling the window.
        //
        // With `fullSizeContentView` the content view extends under the title
        // bar, so a web view pinned to its top swallows every click up there --
        // CodeMirror starts a text selection and the window never gets the
        // mouse-down it needs to be dragged. `contentLayoutGuide` is the region
        // the titlebar does not cover, and it tracks the real titlebar height
        // rather than hard-coding one.
        let topAnchor = (window.contentLayoutGuide as? NSLayoutGuide)?.topAnchor
            ?? contentView.safeAreaLayoutGuide.topAnchor

        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            webView.topAnchor.constraint(equalTo: topAnchor),
            webView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
        ])
    }

    private func loadEditor() {
        guard let dir = Bundle.main.resourceURL?.appendingPathComponent("Editor") else {
            NSLog("[NoteWindow] Editor resources missing")
            return
        }
        webView.loadFileURL(dir.appendingPathComponent("index.html"), allowingReadAccessTo: dir)
    }

    /// Forwards `console.log` from the editor into the Swift log.
    private static func consoleForwardingScript() -> WKUserScript {
        let source = """
        (function () {
          const post = (level, args) => {
            try {
              window.webkit.messageHandlers.bridge.postMessage({
                action: 'log',
                message: '[' + level + '] ' + Array.from(args).map(String).join(' ')
              });
            } catch (e) {}
          };
          ['log', 'warn', 'error'].forEach((level) => {
            const original = console[level].bind(console);
            console[level] = function () { original.apply(console, arguments); post(level, arguments); };
          });
          window.addEventListener('error', (e) => post('error', [e.message]));
        })();
        """
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    // MARK: - Titlebar controls

    private func buildTitlebarAccessory(note: Note) {
        opacitySlider = NSSlider(value: note.opacity, minValue: 0.35, maxValue: 1.0,
                                 target: self, action: #selector(opacityChanged(_:)))
        opacitySlider.controlSize = .mini
        opacitySlider.isContinuous = true
        opacitySlider.toolTip = "Opacity"
        opacitySlider.widthAnchor.constraint(equalToConstant: 56).isActive = true

        colorButton = NSButton(title: "", target: self, action: #selector(showColorMenu(_:)))
        colorButton.isBordered = false
        colorButton.bezelStyle = .shadowlessSquare
        colorButton.toolTip = "Note color"
        colorButton.widthAnchor.constraint(equalToConstant: 16).isActive = true
        colorButton.heightAnchor.constraint(equalToConstant: 16).isActive = true
        colorButton.wantsLayer = true
        colorButton.layer?.cornerRadius = 8
        colorButton.layer?.borderWidth = 1
        colorButton.layer?.borderColor = NSColor.black.withAlphaComponent(0.18).cgColor

        pinButton = NSButton(title: "", target: self, action: #selector(togglePin(_:)))
        pinButton.isBordered = false
        pinButton.bezelStyle = .shadowlessSquare
        pinButton.toolTip = "Keep on top"
        pinButton.widthAnchor.constraint(equalToConstant: 20).isActive = true

        let stack = NSStackView(views: [opacitySlider, colorButton, pinButton])
        stack.orientation = .horizontal
        stack.alignment = .centerY
        stack.spacing = 8
        stack.edgeInsets = NSEdgeInsets(top: 0, left: 8, bottom: 0, right: 12)
        stack.frame = NSRect(x: 0, y: 0, width: 130, height: Self.titlebarHeight)

        let accessory = NSTitlebarAccessoryViewController()
        accessory.view = stack
        accessory.layoutAttribute = .right
        window?.addTitlebarAccessoryViewController(accessory)

        refreshColorButton(NoteColor.from(note.colorTheme))
        refreshPinButton(note.alwaysOnTop)
    }

    private func refreshColorButton(_ color: NoteColor) {
        colorButton.layer?.backgroundColor = color.color.cgColor
    }

    private func refreshPinButton(_ pinned: Bool) {
        let name = pinned ? "pin.fill" : "pin"
        pinButton.image = NSImage(systemSymbolName: name, accessibilityDescription: "Keep on top")
        pinButton.contentTintColor = pinned
            ? NSColor(hex: NoteColor.from(store.note(noteId)?.colorTheme ?? "yellow").accentHex)
            : NSColor.black.withAlphaComponent(0.35)
    }

    // MARK: - Actions

    @objc private func opacityChanged(_ sender: NSSlider) {
        let value = sender.doubleValue
        window?.alphaValue = CGFloat(value)
        store.update(noteId) { $0.opacity = value }
    }

    @objc private func togglePin(_ sender: NSButton) {
        guard let note = store.note(noteId), let window else { return }
        let pinned = !note.alwaysOnTop
        applyAlwaysOnTop(pinned, to: window)
        store.update(noteId) { $0.alwaysOnTop = pinned }
        refreshPinButton(pinned)
    }

    @objc private func showColorMenu(_ sender: NSButton) {
        let menu = NSMenu()
        let current = store.note(noteId)?.colorTheme
        for color in NoteColor.allCases {
            let item = NSMenuItem(title: color.displayName, action: #selector(selectColor(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = color.rawValue
            item.image = Self.swatch(color.color)
            item.state = (color.rawValue == current) ? .on : .off
            menu.addItem(item)
        }
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: sender.bounds.height + 4), in: sender)
    }

    @objc private func selectColor(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String else { return }
        let color = NoteColor.from(raw)
        store.update(noteId) { $0.colorTheme = raw }
        window?.backgroundColor = color.color
        refreshColorButton(color)
        refreshPinButton(store.note(noteId)?.alwaysOnTop ?? false)
        applyThemeToEditor(color)
    }

    private static func swatch(_ color: NSColor) -> NSImage {
        let size = NSSize(width: 12, height: 12)
        let image = NSImage(size: size)
        image.lockFocus()
        color.setFill()
        NSBezierPath(ovalIn: NSRect(origin: .zero, size: size)).fill()
        image.unlockFocus()
        return image
    }

    // MARK: - Editor commands

    func focusEditor() {
        window?.makeFirstResponder(webView)
        webView.evaluateJavaScript("window.focusEditor && window.focusEditor()")
    }

    func openSearch(replace: Bool) {
        webView.evaluateJavaScript("window.openSearch && window.openSearch(\(replace))")
    }

    func applyFormat(_ command: String) {
        webView.evaluateJavaScript("window.applyFormat && window.applyFormat('\(command)')")
    }

    /// Steps the note's text size, clamped to a readable range.
    func adjustFontSize(by delta: Double) {
        guard let note = store.note(noteId) else { return }
        let target = (note.fontSize + delta).clamped(to: Note.fontSizeRange)
        guard target != note.fontSize else { return }
        store.update(noteId) { $0.fontSize = target }
        applyFontSize(target)
    }

    func resetFontSize() {
        store.update(noteId) { $0.fontSize = Note.defaultFontSize }
        applyFontSize(Note.defaultFontSize)
    }

    private func applyFontSize(_ size: Double) {
        webView.evaluateJavaScript("window.setFontSize && window.setFontSize(\(size))")
    }

    private func applyThemeToEditor(_ color: NoteColor) {
        let js = "window.setTheme && window.setTheme('\(color.hex)', '\(color.accentHex)')"
        webView.evaluateJavaScript(js)
    }

    /// Pushes note content into the editor. Only ever called once per load —
    /// afterwards the editor owns the document and Swift only receives changes.
    private func deliverPendingLoad() {
        guard isEditorReady, let note = pendingLoad else { return }
        pendingLoad = nil

        let color = NoteColor.from(note.colorTheme)
        let payload: [String: Any] = [
            "content": note.content,
            "cursor": note.cursorPosition,
            "scrollTop": note.scrollTop,
            "paper": color.hex,
            "accent": color.accentHex,
            "fontSize": note.fontSize,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }

        // callAsyncJavaScript passes the JSON as a real argument, sidestepping
        // any string-escaping problems with arbitrary note content.
        webView.callAsyncJavaScript(
            "window.loadNote(payload);",
            arguments: ["payload": json],
            in: nil,
            in: .page
        ) { [weak self] result in
            if case .failure(let error) = result {
                NSLog("[NoteWindow] loadNote failed: \(error)")
            }
            self?.focusEditor()
        }
    }

    // MARK: - Teardown

    /// Closes the window and releases the web view. Must be called instead of
    /// `close()` from anywhere that also removes the note from the store.
    func tearDown() {
        bridge.delegate = nil
        bridge.uninstall(from: webView.configuration.userContentController)
        webView.navigationDelegate = nil
        webView.removeFromSuperview()
        window?.delegate = nil
        window?.close()
    }
}

// MARK: - Bridge

extension NoteWindowController: EditorBridgeDelegate {
    func editorBridge(_ bridge: EditorBridge, didReceive message: EditorMessage) {
        switch message {
        case .ready:
            isEditorReady = true
            deliverPendingLoad()

        case .contentChanged(let content):
            store.update(noteId, touchModified: true) { $0.content = content }
            window?.title = store.note(noteId)?.displayTitle ?? "Note"

        case .selectionChanged(let cursor, let scrollTop):
            store.update(noteId) {
                $0.cursorPosition = cursor
                $0.scrollTop = scrollTop
            }

        case .requestSave:
            store.flush()

        case .requestZoom(let delta):
            adjustFontSize(by: delta)

        case .requestNewNote:
            noteDelegate?.noteWindowDidRequestNewNote(self)

        case .requestCloseNote:
            window?.performClose(nil)

        case .openURL(let url):
            guard ["http", "https", "mailto", "file"].contains(url.scheme ?? "") else { return }
            NSWorkspace.shared.open(url)

        case .log(let text):
            NSLog("[Editor] \(text)")
        }
    }
}

// MARK: - Window delegate

extension NoteWindowController: NSWindowDelegate {
    func windowDidMove(_ notification: Notification) { persistFrame() }
    func windowDidResize(_ notification: Notification) { persistFrame() }

    private func persistFrame() {
        guard let frame = window?.frame else { return }
        store.update(noteId) {
            $0.position = frame.origin
            $0.size = frame.size
        }
    }

    func windowDidBecomeKey(_ notification: Notification) {
        refreshPinButton(store.note(noteId)?.alwaysOnTop ?? false)
    }

    /// Closing a sticky note discards it, so an untitled scratch note vanishes
    /// without ceremony while a note with real content always asks first.
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        let note = store.note(noteId)
        let body = note?.content.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        if body.isEmpty {
            noteDelegate?.noteWindowDidRequestDelete(self)
            return false        // the delete path tears the window down itself
        }

        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Delete this note?"
        alert.informativeText = "\u{201C}\(note?.displayTitle ?? "Note")\u{201D} will be deleted permanently."
        alert.addButton(withTitle: "Delete")
        alert.addButton(withTitle: "Cancel")

        guard alert.runModal() == .alertFirstButtonReturn else { return false }
        noteDelegate?.noteWindowDidRequestDelete(self)
        return false
    }

    func windowWillClose(_ notification: Notification) {
        noteDelegate?.noteWindowDidClose(self)
    }
}

private extension Double {
    func clamped(to range: ClosedRange<Double>) -> Double {
        min(max(self, range.lowerBound), range.upperBound)
    }
}

/// `NSPanel` refuses key status for utility windows by default, which would
/// leave the editor unable to receive keystrokes.
final class NotePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}
