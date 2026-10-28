import AppKit

/// Owns the note store and the set of open windows, and keeps them in sync.
final class AppCoordinator: NSObject {

    let store: NoteStore
    private var controllers: [UUID: NoteWindowController] = [:]

    /// Offset applied to each successive new note so they never stack exactly.
    private var cascadeStep = 0

    /// Suppresses the "always keep one note open" rule during shutdown.
    private var isTerminating = false

    init(store: NoteStore = NoteStore()) {
        self.store = store
        super.init()
    }

    // MARK: - Lifecycle

    func restoreSession() {
        if store.isEmpty {
            createNote()
        } else {
            for note in store.notes { openWindow(for: note) }
            controllers.values.first?.window?.makeKeyAndOrderFront(nil)
        }
    }

    func terminate() {
        isTerminating = true
        store.flush()
    }

    /// Dock-icon click. Only makes a note when there is genuinely nothing to
    /// show -- windows that are merely hidden or minimised must be raised
    /// rather than buried under a new empty note.
    func handleReopen() {
        guard controllers.isEmpty else {
            for controller in controllers.values {
                controller.window?.deminiaturize(nil)
            }
            NSApp.arrangeInFront(nil)
            controllers.values.first?.window?.makeKeyAndOrderFront(nil)
            return
        }

        // Windows are gone but notes may still be stored -- reopen those first.
        if !store.isEmpty {
            for note in store.notes { openWindow(for: note) }
            controllers.values.first?.window?.makeKeyAndOrderFront(nil)
            return
        }

        createNote()
    }

    // MARK: - Notes

    @discardableResult
    func createNote() -> NoteWindowController? {
        var note = Note()
        note.position = nextCascadeOrigin(for: note.size)
        // Inherit the frontmost note's look so a new note matches its neighbours.
        if let front = frontmostController(), let source = store.note(front.noteId) {
            note.colorTheme = source.colorTheme
            note.opacity = source.opacity
        }
        store.addNote(note)
        let controller = openWindow(for: note)
        controller?.window?.makeKeyAndOrderFront(nil)
        controller?.focusEditor()
        return controller
    }

    @discardableResult
    private func openWindow(for note: Note) -> NoteWindowController? {
        if let existing = controllers[note.id] { return existing }
        let controller = NoteWindowController(note: note, store: store)
        controller.noteDelegate = self
        controllers[note.id] = controller
        controller.showWindow(nil)
        return controller
    }

    /// Places each new note down-right of the last, wrapping before it runs off
    /// the visible area of the active screen.
    private func nextCascadeOrigin(for size: CGSize) -> CGPoint {
        guard let visible = (NSScreen.main ?? NSScreen.screens.first)?.visibleFrame else {
            return CGPoint(x: 120, y: 120)
        }
        let step: CGFloat = 26
        let maxSteps = 8
        let index = cascadeStep % maxSteps
        cascadeStep += 1

        let x = visible.minX + 80 + CGFloat(index) * step
        let y = visible.maxY - size.height - 80 - CGFloat(index) * step
        return CGPoint(x: x, y: max(y, visible.minY + 20))
    }

    private func frontmostController() -> NoteWindowController? {
        guard let key = NSApp.keyWindow else { return controllers.values.first }
        return controllers.values.first { $0.window === key } ?? controllers.values.first
    }

    // MARK: - Menu commands

    @objc func newNote(_ sender: Any?) { createNote() }

    @objc func cycleNotes(_ sender: Any?) {
        let windows = controllers.values.compactMap(\.window).sorted { $0.frame.origin.y > $1.frame.origin.y }
        guard !windows.isEmpty else { return }
        guard let key = NSApp.keyWindow, let idx = windows.firstIndex(of: key) else {
            windows[0].makeKeyAndOrderFront(nil)
            return
        }
        windows[(idx + 1) % windows.count].makeKeyAndOrderFront(nil)
    }

    private var keyController: NoteWindowController? {
        guard let key = NSApp.keyWindow else { return nil }
        return controllers.values.first { $0.window === key }
    }

    @objc func findInNote(_ sender: Any?) { keyController?.openSearch(replace: false) }
    @objc func findAndReplace(_ sender: Any?) { keyController?.openSearch(replace: true) }
    @objc func formatBold(_ sender: Any?) { keyController?.applyFormat("bold") }
    @objc func formatItalic(_ sender: Any?) { keyController?.applyFormat("italic") }
    @objc func formatCode(_ sender: Any?) { keyController?.applyFormat("code") }
    @objc func formatLink(_ sender: Any?) { keyController?.applyFormat("link") }
    @objc func formatStrikethrough(_ sender: Any?) { keyController?.applyFormat("strikethrough") }
    @objc func toggleTask(_ sender: Any?) { keyController?.applyFormat("task") }
    @objc func selectLine(_ sender: Any?) { keyController?.applyFormat("selectLine") }
    @objc func moveLineUp(_ sender: Any?) { keyController?.applyFormat("moveBlockUp") }
    @objc func moveLineDown(_ sender: Any?) { keyController?.applyFormat("moveBlockDown") }

    @objc func editUndo(_ sender: Any?) { keyController?.applyFormat("undo") }
    @objc func editRedo(_ sender: Any?) { keyController?.applyFormat("redo") }

    @objc func zoomIn(_ sender: Any?) { keyController?.adjustFontSize(by: 1) }
    @objc func zoomOut(_ sender: Any?) { keyController?.adjustFontSize(by: -1) }
    @objc func actualSize(_ sender: Any?) { keyController?.resetFontSize() }

    @objc func saveNow(_ sender: Any?) { store.flush() }
}

// MARK: - Window callbacks

extension AppCoordinator: NoteWindowControllerDelegate {

    func noteWindowDidRequestNewNote(_ controller: NoteWindowController) {
        createNote()
    }

    func noteWindowDidClose(_ controller: NoteWindowController) {
        controllers.removeValue(forKey: controller.noteId)
        store.flush()
        replaceLastNoteIfNeeded()
    }

    func noteWindowDidRequestDelete(_ controller: NoteWindowController) {
        controllers.removeValue(forKey: controller.noteId)
        store.deleteNote(controller.noteId)
        controller.tearDown()
        store.flush()
        replaceLastNoteIfNeeded()
    }

    /// The app is a note board, not a document editor: with no notes left there
    /// is nothing to show, so open a fresh one rather than stranding the user
    /// with a running app and no window. Skipped while quitting.
    private func replaceLastNoteIfNeeded() {
        guard controllers.isEmpty, !isTerminating else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self, self.controllers.isEmpty, !self.isTerminating else { return }
            self.createNote()
        }
    }
}
