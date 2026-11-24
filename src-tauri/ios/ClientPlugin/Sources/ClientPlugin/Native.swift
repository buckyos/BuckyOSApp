import ClientBridge
import Foundation

/// The Rust side, where the answer is needed at once or nobody asked.
enum Native {
  static func event(_ kind: String, _ fields: [String: Any] = [:]) {
    var event = fields
    event["kind"] = kind
    guard let data = try? JSONSerialization.data(withJSONObject: event),
      let text = String(data: data, encoding: .utf8)
    else { return }
    bucky_on_event(text)
  }

  static func mayNavigate(view: String, url: URL, mainFrame: Bool, newWindow: Bool) -> Bool {
    bucky_on_navigate(view, url.absoluteString, mainFrame, newWindow)
  }

  static func call(view: String, origin: String, mainFrame: Bool, message: String, replyId: Int64) {
    bucky_on_call(view, origin, mainFrame, message, replyId)
  }
}

func warn(_ message: String) {
  NSLog("[BuckyOS] %@", message)
}

/// A JavaScript (and JSON) literal.
func literal(_ value: Any) -> String {
  guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
    let text = String(data: data, encoding: .utf8)
  else { return "null" }
  return text
    .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
    .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
}
