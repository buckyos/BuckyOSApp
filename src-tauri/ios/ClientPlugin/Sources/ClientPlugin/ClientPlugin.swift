import Tauri
import WebKit

/// What the Rust side asks of the client (`content/mobile/views.rs`); `ClientPlugin.kt` has the same.
final class ClientPlugin: Plugin {
  private func run(_ invoke: Invoke, _ work: @escaping @MainActor (Client) -> (Invoke) -> Void) {
    DispatchQueue.main.async { MainActor.assumeIsolated { work(Client.shared)(invoke) } }
  }

  @objc override func load(webview: WKWebView) {
    DispatchQueue.main.async { MainActor.assumeIsolated { Client.shared.take(webview) } }
  }

  @objc public func create(_ invoke: Invoke) { run(invoke) { $0.create } }
  @objc public func load(_ invoke: Invoke) { run(invoke) { $0.load } }
  @objc public func goTo(_ invoke: Invoke) { run(invoke) { $0.goTo } }
  @objc public func close(_ invoke: Invoke) { run(invoke) { $0.close } }
  @objc public func show(_ invoke: Invoke) { run(invoke) { $0.show } }
  @objc public func overlay(_ invoke: Invoke) { run(invoke) { $0.overlay } }
  @objc public func eval(_ invoke: Invoke) { run(invoke) { $0.eval } }
  @objc public func back(_ invoke: Invoke) { run(invoke) { $0.back } }
  @objc public func stop(_ invoke: Invoke) { run(invoke) { $0.stop } }
  @objc public func toBackground(_ invoke: Invoke) { run(invoke) { $0.toBackground } }
  @objc public func reply(_ invoke: Invoke) { run(invoke) { $0.reply } }
  @objc public func getCookies(_ invoke: Invoke) { run(invoke) { $0.getCookies } }
  @objc public func setCookies(_ invoke: Invoke) { run(invoke) { $0.setCookies } }
  @objc public func setProxy(_ invoke: Invoke) { run(invoke) { $0.setProxy } }
  @objc public func clearProfile(_ invoke: Invoke) { run(invoke) { $0.clearProfile } }
  @objc public func signPrompt(_ invoke: Invoke) { run(invoke) { $0.signPrompt } }
  @objc public func signDone(_ invoke: Invoke) { run(invoke) { $0.signDone } }
  @objc public func askMicrophone(_ invoke: Invoke) { run(invoke) { $0.askMicrophone } }
  @objc public func status(_ invoke: Invoke) { run(invoke) { $0.status } }
  @objc public func openSettings(_ invoke: Invoke) { run(invoke) { $0.openSettings } }
  @objc public func share(_ invoke: Invoke) { run(invoke) { $0.share } }
  @objc public func playback(_ invoke: Invoke) { run(invoke) { $0.playback } }
  @objc public func record(_ invoke: Invoke) { run(invoke) { $0.record } }
}

@_cdecl("init_plugin_client")
func initPlugin() -> Plugin {
  ClientPlugin()
}
