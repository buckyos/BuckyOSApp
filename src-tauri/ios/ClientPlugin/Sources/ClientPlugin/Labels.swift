import Foundation

/// Texts of what is drawn natively, in the language of the local pages (`native_set_labels` leaves
/// them in a file).
struct Labels {
  private static let file = "native-labels.json"
  private let values: [String: Any]

  static func load() -> Labels {
    let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
    let path = folder?.appendingPathComponent(Bundle.main.bundleIdentifier ?? "").appendingPathComponent(file)
    let values = path.flatMap { try? Data(contentsOf: $0) }.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    return Labels(values: values ?? [:])
  }

  private func text(_ key: String, _ fallback: String) -> String {
    guard let value = values[key] as? String, !value.trimmingCharacters(in: .whitespaces).isEmpty else { return fallback }
    return value
  }

  var playing: String { text("playing", "Playing audio") }
  var signTitle: String { text("signTitle", "Sign") }
  var signAsk: String { text("signAsk", "{app} ({zone}) asks you to sign this:") }
  var signDevice: String { text("signDevice", "The device at {zone} asks you to sign this, and gets the digest of your wallet password:") }
  var signIdentity: String { text("signIdentity", "Identity: {app}") }
  var signPassword: String { text("signPassword", "Wallet password") }
  var signWrong: String { text("signWrong", "Wrong password") }
  var confirm: String { text("confirm", "Confirm") }
  var cancel: String { text("cancel", "Cancel") }
  var allow: String { text("allow", "Allow") }
  var deny: String { text("deny", "Don't allow") }
  var micAsk: String { text("micAsk", "{app} ({zone}) wants to use the microphone") }
}

extension String {
  /// Fills a text's `{name}` places in one pass: what is filled in is not looked at again.
  func filled(_ values: [String: String]) -> String {
    var result = ""
    var rest = Substring(self)
    while let open = rest.firstIndex(of: "{"), let close = rest[open...].firstIndex(of: "}") {
      let name = String(rest[rest.index(after: open)..<close])
      result += rest[..<open]
      result += values[name] ?? String(rest[open...close])
      rest = rest[rest.index(after: close)...]
    }
    return result + rest
  }
}
