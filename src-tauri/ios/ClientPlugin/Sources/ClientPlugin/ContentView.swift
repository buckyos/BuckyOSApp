import UIKit
import WebKit

/// One page of a Zone, or a device's activation page (no `zoneHost`): the top document of a WebView
/// of its own.
@MainActor
final class ContentView: NSObject {
  let id: String
  let profile: String
  let label: String
  let web: WKWebView
  private let zoneHost: String
  private unowned let client: Client
  private var watches: [NSKeyValueObservation] = []
  /// A load of the client's own is on its way.
  private var arriving = false
  /// Another document is on its way: the address is not yet that of a page.
  private var leaving = false
  private var failed = false
  private(set) var gone = false
  private var microphoneAllowed = false
  /// The page the client's last load arrived at. What was before is not for the user to go back to.
  private var floor: WKBackForwardListItem?
  /// Answers the dialogs of the page that are open.
  private var dialogs: [ObjectIdentifier: () -> Void] = [:]

  init(client: Client, id: String, profile: String, zoneHost: String, label: String, rules: [String], script: String) {
    self.client = client
    self.id = id
    self.profile = profile
    self.zoneHost = zoneHost
    self.label = label
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = Profiles.store(profile)
    configuration.allowsInlineMediaPlayback = true
    configuration.mediaTypesRequiringUserActionForPlayback = []
    configuration.preferences.isElementFullscreenEnabled = true
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    configuration.preferences.inactiveSchedulingPolicy = .throttle
    // The handler is there for every page and frame of the view; who may call is decided in Rust.
    // The scripts are for the pages of the rules only.
    configuration.userContentController.addUserScript(
      WKUserScript(source: Self.guarded(script, rules: rules), injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
    web = WKWebView(frame: .zero, configuration: configuration)
    super.init()
    configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: Self.handler)
    web.navigationDelegate = self
    web.uiDelegate = self
    web.isOpaque = false
    web.backgroundColor = .clear
    web.scrollView.backgroundColor = .clear
    web.scrollView.contentInsetAdjustmentBehavior = .never
    // Back is the app's first (`frame.back`), and ends at `floor`.
    web.allowsBackForwardNavigationGestures = false
    web.allowsLinkPreview = false
    Keyboard.leave(web)
    #if DEBUG
      web.isInspectable = true
    #endif
    watches = [
      web.observe(\.url) { [weak self] _, _ in
        // It also changes to an address that is only being asked for; that is known a moment later.
        DispatchQueue.main.async { self?.addressChanged() }
      },
      web.observe(\.title) { [weak self] web, _ in
        MainActor.assumeIsolated {
          guard let self, let title = web.title, !title.isEmpty, !self.failed else { return }
          self.event("title", ["title": title])
        }
      },
    ]
  }

  private static let handler = "buckyPort"

  /// The scripts run where the rules allow, and the native bridge looks like Android's.
  private static func guarded(_ script: String, rules: [String]) -> String {
    """
    (() => {
      const here = (rule) => {
        const any = rule.indexOf("://*.");
        return any < 0
          ? location.origin === rule
          : location.protocol === rule.slice(0, any + 1) && location.host.endsWith(rule.slice(any + 4));
      };
      if (window.top !== window || !\(literal(rules)).some(here)) return;
      const handler = window.webkit.messageHandlers.\(handler);
      const send = handler.postMessage.bind(handler);
      const port = {
        onmessage: null,
        postMessage(text) {
          send(text).then((data) => port.onmessage && port.onmessage({ data }), () => undefined);
        },
      };
      Object.defineProperty(window, "__buckyPort", { value: port });
      \(script)
    })();
    """
  }

  func event(_ kind: String, _ fields: [String: Any] = [:]) {
    if gone { return }
    var event = fields
    event["view"] = id
    Native.event(kind, event)
  }

  var isOfZone: Bool { !zoneHost.isEmpty }

  func isInZone(_ host: String?) -> Bool {
    guard let name = host?.lowercased(), !zoneHost.isEmpty else { return false }
    return name == zoneHost || name.hasSuffix(".\(zoneHost)")
  }

  // ---- pages ----

  /// A load of the client's own: the address may carry a one-time sign-in, so no page gets to see
  /// it. What was before is forgotten; going back does not meet the round trip.
  func load(_ url: URL) {
    arriving = true
    leaving = true
    web.load(URLRequest(url: url))
  }

  /// A page of the same host, as a step the user can go back from.
  func go(to url: URL) {
    web.load(URLRequest(url: url))
  }

  /// One step, and not before `floor`: `goBack` may take several at once.
  func back() -> Bool {
    let list = web.backForwardList
    guard let item = list.backItem, list.currentItem !== floor else { return false }
    web.go(to: item)
    return true
  }

  func stop() {
    web.stopLoading()
    _ = back()
  }

  /// Hidden, the page is like a tab in the background: no animation, slow timers; sound goes on. To
  /// a page in the window WebKit would say that it is visible, even under `isHidden`.
  func show(in host: UIView) {
    if web.superview !== host { host.addSubview(web) }
  }

  func hide() {
    web.closeAllMediaPresentations(completionHandler: nil)
    web.removeFromSuperview()
  }

  /// A page whose sound goes on is not slowed down while it is hidden.
  func setPlaying(_ playing: Bool) {
    web.configuration.preferences.inactiveSchedulingPolicy = playing ? .none : .throttle
  }

  func destroy() {
    if gone { return }
    gone = true
    watches.removeAll()
    let open = dialogs.values
    dialogs.removeAll()
    open.forEach { $0() }
    web.stopLoading()
    web.navigationDelegate = nil
    web.uiDelegate = nil
    web.configuration.userContentController.removeAllUserScripts()
    web.configuration.userContentController.removeAllScriptMessageHandlers()
    web.removeFromSuperview()
  }

  private func addressChanged() {
    guard !gone, !leaving, !failed, let url = web.url else { return }
    event("visited", ["url": url.absoluteString])
  }

  // ---- questions ----

  /// Asks the user once per view, then the system.
  func askMicrophone(_ done: @escaping (Bool) -> Void) {
    if microphoneAllowed {
      Microphone.request(done)
      return
    }
    guard let presenter = client.presenter(for: self) else {
      done(false)
      return
    }
    Dialogs.askMicrophone(on: presenter, app: label, zone: zoneHost) { [weak self] allowed in
      guard allowed, let self, !self.gone else {
        done(false)
        return
      }
      Microphone.request { granted in
        self.microphoneAllowed = granted
        done(granted)
      }
    }
  }

  /// A dialog of the page. One that the user does not look at gets no answer but no.
  private func dialog(
    _ message: String, _ frame: WKFrameInfo, field: String? = nil, cancel: Bool, done: @escaping (Bool, String?) -> Void
  ) {
    guard let presenter = client.presenter(for: self) else {
      done(false, nil)
      return
    }
    let host = frame.securityOrigin.host
    let alert = Dialogs.page(title: host.isEmpty ? label : "\(label)\n\(host)", message: message, field: field, cancel: cancel) { accepted, text in
      done(accepted, text)
    }
    let key = ObjectIdentifier(alert.controller)
    dialogs[key] = { alert.close() }
    alert.ended = { [weak self] in self?.dialogs.removeValue(forKey: key) }
    presenter.present(alert.controller, animated: true)
  }
}

// ---- where it goes ----

extension ContentView: WKNavigationDelegate {
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard !gone, let url = action.request.url else {
      decisionHandler(.cancel)
      return
    }
    if action.shouldPerformDownload {
      decisionHandler(client.downloads.accepts(url, of: self) ? .download : .cancel)
      return
    }
    guard let target = action.targetFrame else {
      // A link to a new window; views never open windows.
      _ = Native.mayNavigate(view: id, url: url, mainFrame: true, newWindow: true)
      decisionHandler(.cancel)
      return
    }
    let allowed = Native.mayNavigate(view: id, url: url, mainFrame: target.isMainFrame, newWindow: false)
    decisionHandler(allowed ? .allow : .cancel)
  }

  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")
    let attached = disposition?.lowercased().trimmingCharacters(in: .whitespaces).hasPrefix("attachment") ?? false
    if response.canShowMIMEType && !attached {
      decisionHandler(.allow)
      return
    }
    decisionHandler(response.response.url.map { client.downloads.accepts($0, of: self) } == true ? .download : .cancel)
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    client.downloads.start(download, of: self)
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    client.downloads.start(download, of: self)
  }

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    leaving = true
  }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    leaving = false
    failed = false
    if arriving {
      floor = web.backForwardList.currentItem
      arriving = web.url?.path == "/sso_callback"
    }
    if let url = web.url { event("started", ["url": url.absoluteString]) }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    leaving = false
    if !failed, let url = web.url { event("finished", ["url": url.absoluteString]) }
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    fail(error)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    fail(error)
  }

  private func fail(_ error: Error) {
    leaving = false
    let error = error as NSError
    // Not failures: another load came instead, the client took over, it became a download.
    if error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled { return }
    if error.domain == "WebKitErrorDomain" && [102, 204].contains(error.code) { return }
    failed = true
    let url = (error.userInfo[NSURLErrorFailingURLErrorKey] as? URL) ?? web.url
    event("failed", ["url": url?.absoluteString ?? "", "detail": error.localizedDescription])
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    event("gone")
    client.dropped(self)
  }
}

// ---- what it asks ----

extension ContentView: WKUIDelegate {
  /// `window.open`. Views never open windows: only the address counts.
  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if !gone, let url = action.request.url, !url.absoluteString.isEmpty {
      _ = Native.mayNavigate(view: id, url: url, mainFrame: true, newWindow: true)
    }
    return nil
  }

  func webView(
    _ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo,
    type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void
  ) {
    guard type == .microphone, origin.protocol == "https", isInZone(origin.host) else {
      decisionHandler(.deny)
      return
    }
    askMicrophone { decisionHandler($0 ? .grant : .deny) }
  }

  func webView(
    _ webView: WKWebView, requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo,
    decisionHandler: @escaping (WKPermissionDecision) -> Void
  ) {
    decisionHandler(.deny)
  }

  func webView(
    _ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping () -> Void
  ) {
    dialog(message, frame, cancel: false) { _, _ in completionHandler() }
  }

  func webView(
    _ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping (Bool) -> Void
  ) {
    dialog(message, frame, cancel: true) { accepted, _ in completionHandler(accepted) }
  }

  func webView(
    _ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping (String?) -> Void
  ) {
    dialog(prompt, frame, field: defaultText ?? "", cancel: true) { accepted, text in completionHandler(accepted ? text : nil) }
  }
}

// ---- the bridge ----

extension ContentView: WKScriptMessageHandlerWithReply {
  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void
  ) {
    guard !gone, let text = message.body as? String else {
      replyHandler(nil, "not a call")
      return
    }
    // The origin is the document's, as WebKit knows it. One without (`data:`, `about:`) has none.
    let origin = message.frameInfo.securityOrigin
    let port = origin.port == 0 ? "" : ":\(origin.port)"
    let reply = client.wait(replyHandler, of: id)
    Native.call(view: id, origin: "\(origin.protocol)://\(origin.host)\(port)", mainFrame: message.frameInfo.isMainFrame, message: text, replyId: reply)
  }
}
