import AppKit

@main
enum StickyNotesApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {

    private let coordinator = AppCoordinator()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = MenuBuilder.build(target: coordinator)
        coordinator.restoreSession()
        NSApp.activate(ignoringOtherApps: true)
    }

    /// Notes live on their own; the app stays running with no windows only
    /// long enough for the coordinator to open a replacement.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        coordinator.handleReopen()
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        coordinator.terminate()
    }
}

/// Builds the menu bar.
///
/// Editor shortcuts must be declared here even though the editor implements
/// them: macOS dispatches key equivalents to the menu bar first, so a shortcut
/// that only exists inside the web view is swallowed before it ever arrives.
enum MenuBuilder {

    static func build(target: AppCoordinator) -> NSMenu {
        let main = NSMenu()
        main.addItem(appMenu())
        main.addItem(fileMenu(target))
        main.addItem(editMenu(target))
        main.addItem(formatMenu(target))
        main.addItem(viewMenu(target))
        main.addItem(windowMenu(target))
        return main
    }

    private static func submenu(_ title: String) -> (NSMenuItem, NSMenu) {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        let menu = NSMenu(title: title)
        item.submenu = menu
        return (item, menu)
    }

    private static func add(
        _ menu: NSMenu,
        _ title: String,
        _ action: Selector?,
        _ key: String = "",
        _ modifiers: NSEvent.ModifierFlags = .command,
        target: AnyObject? = nil
    ) {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.keyEquivalentModifierMask = modifiers
        item.target = target
        menu.addItem(item)
    }

    private static func appMenu() -> NSMenuItem {
        let (item, menu) = submenu("MD Sticky Note")
        add(menu, "About MD Sticky Note", #selector(NSApplication.orderFrontStandardAboutPanel(_:)))
        menu.addItem(.separator())
        add(menu, "Hide MD Sticky Note", #selector(NSApplication.hide(_:)), "h")
        add(menu, "Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option])
        menu.addItem(.separator())
        add(menu, "Quit MD Sticky Note", #selector(NSApplication.terminate(_:)), "q")
        return item
    }

    private static func fileMenu(_ target: AppCoordinator) -> NSMenuItem {
        let (item, menu) = submenu("File")
        add(menu, "New Note", #selector(AppCoordinator.newNote(_:)), "n", target: target)
        menu.addItem(.separator())
        add(menu, "Close Note", #selector(NSWindow.performClose(_:)), "w")
        add(menu, "Save Now", #selector(AppCoordinator.saveNow(_:)), "s", target: target)
        return item
    }

    private static func editMenu(_ target: AppCoordinator) -> NSMenuItem {
        let (item, menu) = submenu("Edit")
        // Undo/redo are routed to the editor rather than the web view's own
        // undo manager, which does not track CodeMirror's history.
        add(menu, "Undo", #selector(AppCoordinator.editUndo(_:)), "z", target: target)
        add(menu, "Redo", #selector(AppCoordinator.editRedo(_:)), "z", [.command, .shift], target: target)
        menu.addItem(.separator())
        add(menu, "Cut", #selector(NSText.cut(_:)), "x")
        add(menu, "Copy", #selector(NSText.copy(_:)), "c")
        add(menu, "Paste", #selector(NSText.paste(_:)), "v")
        add(menu, "Select All", #selector(NSText.selectAll(_:)), "a")
        add(menu, "Select Line", #selector(AppCoordinator.selectLine(_:)), "l", target: target)
        menu.addItem(.separator())
        add(menu, "Find...", #selector(AppCoordinator.findInNote(_:)), "f", target: target)
        add(menu, "Find and Replace...", #selector(AppCoordinator.findAndReplace(_:)), "f", [.command, .shift], target: target)
        return item
    }

    private static func formatMenu(_ target: AppCoordinator) -> NSMenuItem {
        let (item, menu) = submenu("Format")
        add(menu, "Bold", #selector(AppCoordinator.formatBold(_:)), "b", target: target)
        add(menu, "Italic", #selector(AppCoordinator.formatItalic(_:)), "i", target: target)
        add(menu, "Strikethrough", #selector(AppCoordinator.formatStrikethrough(_:)), "x", [.command, .shift], target: target)
        add(menu, "Inline Code", #selector(AppCoordinator.formatCode(_:)), "e", target: target)
        add(menu, "Link", #selector(AppCoordinator.formatLink(_:)), "k", target: target)
        menu.addItem(.separator())
        add(menu, "Toggle Task", #selector(AppCoordinator.toggleTask(_:)), "l", [.command, .shift], target: target)
        menu.addItem(.separator())

        // An item moves with everything nested under it, so these are "move
        // block" rather than "move line".
        let up = String(UnicodeScalar(UInt16(NSUpArrowFunctionKey))!)
        let down = String(UnicodeScalar(UInt16(NSDownArrowFunctionKey))!)
        add(menu, "Move Up", #selector(AppCoordinator.moveLineUp(_:)), up, [.command, .control], target: target)
        add(menu, "Move Down", #selector(AppCoordinator.moveLineDown(_:)), down, [.command, .control], target: target)
        return item
    }

    private static func viewMenu(_ target: AppCoordinator) -> NSMenuItem {
        let (item, menu) = submenu("View")
        // "+" is what Cmd+Shift+= produces. Cmd+= is deliberately left unclaimed
        // here so it reaches the editor's own keymap, which forwards it back --
        // that way both of the usual zoom-in chords work.
        add(menu, "Zoom In", #selector(AppCoordinator.zoomIn(_:)), "+", target: target)
        add(menu, "Zoom Out", #selector(AppCoordinator.zoomOut(_:)), "-", target: target)
        add(menu, "Actual Size", #selector(AppCoordinator.actualSize(_:)), "0", target: target)
        return item
    }

    private static func windowMenu(_ target: AppCoordinator) -> NSMenuItem {
        let (item, menu) = submenu("Window")
        add(menu, "Minimize", #selector(NSWindow.performMiniaturize(_:)), "m")
        add(menu, "Cycle Through Notes", #selector(AppCoordinator.cycleNotes(_:)), "`", target: target)
        menu.addItem(.separator())
        add(menu, "Bring All to Front", #selector(NSApplication.arrangeInFront(_:)))
        return item
    }
}
