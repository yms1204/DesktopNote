import Foundation
import WebKit

/// Messages the editor can send to Swift.
enum EditorMessage {
    case ready
    case contentChanged(String)
    case selectionChanged(cursor: Int, scrollTop: Double)
    case requestSave
    case requestZoom(delta: Double)
    case requestNewNote
    case requestCloseNote
    case openURL(URL)
    case log(String)
}

protocol EditorBridgeDelegate: AnyObject {
    func editorBridge(_ bridge: EditorBridge, didReceive message: EditorMessage)
}

/// One bridge per note window.
///
/// `WKUserContentController` retains its message handlers, so installing the
/// bridge directly would keep the window alive forever. `install(on:)` therefore
/// registers a weak trampoline, and `uninstall(from:)` tears it down on close.
final class EditorBridge: NSObject {

    static let handlerName = "bridge"

    weak var delegate: EditorBridgeDelegate?

    func install(on controller: WKUserContentController) {
        controller.add(WeakScriptMessageHandler(self), name: Self.handlerName)
    }

    func uninstall(from controller: WKUserContentController) {
        controller.removeScriptMessageHandler(forName: Self.handlerName)
    }
}

extension EditorBridge: WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }

        let parsed: EditorMessage?
        switch action {
        case "ready":
            parsed = .ready
        case "contentChanged":
            parsed = (body["content"] as? String).map(EditorMessage.contentChanged)
        case "selectionChanged":
            parsed = .selectionChanged(
                cursor: body["cursor"] as? Int ?? 0,
                scrollTop: body["scrollTop"] as? Double ?? 0
            )
        case "requestSave":
            parsed = .requestSave
        case "requestZoom":
            parsed = .requestZoom(delta: body["delta"] as? Double ?? 0)
        case "requestNewNote":
            parsed = .requestNewNote
        case "requestCloseNote":
            parsed = .requestCloseNote
        case "openURL":
            parsed = (body["url"] as? String).flatMap(URL.init(string:)).map(EditorMessage.openURL)
        case "log":
            parsed = (body["message"] as? String).map(EditorMessage.log)
        default:
            NSLog("[Bridge] unknown action: \(action)")
            parsed = nil
        }

        if let parsed { delegate?.editorBridge(self, didReceive: parsed) }
    }
}

/// Breaks the `WKUserContentController` -> handler -> window retain cycle.
private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
