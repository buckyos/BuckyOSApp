import Network
import Tauri
import UIKit
import WebKit

/// The content views and the other native parts of the client.
@MainActor
final class Client: NSObject {
  static let shared = Client()

  private var container: ContainerView?
  private var back: BackGesture?
  private var views: [String: ContentView] = [:]
  private var replies: [Int64: (view: String, answer: (Any?, String?) -> Void)] = [:]
  private var nextReply: Int64 = 1
  private var shown: String?
  private var stage = CGRect.zero
  private var keyboard: CGFloat = 0
  private var signPrompt: SignPrompt?
  private var signInvoke: Invoke?
  private let network = NWPathMonitor()
  private var settled = false
  private let playing = Playback()
  private let recorder = Recorder()
  let downloads = Downloads()

  // ---- the window ----

  /// The local pages' WebView comes from Tauri; the content views go below it.
  func take(_ web: WKWebView) {
    if container != nil { return }
    guard let root = web.superview else {
      // Not in the window yet.
      DispatchQueue.main.async { self.take(web) }
      return
    }
    Profiles.cleanUp()
    let container = ContainerView(web: web, frame: root.bounds)
    container.backgroundColor = .ground
    root.insertSubview(container, at: 0)
    // Content views show through where the local page leaves room.
    web.isOpaque = false
    web.backgroundColor = .clear
    web.underPageBackgroundColor = .clear
    web.scrollView.backgroundColor = .clear
    web.scrollView.contentInsetAdjustmentBehavior = .never
    // Its places are those of the screen: it does not scroll or zoom as a whole.
    web.scrollView.isScrollEnabled = false
    web.scrollView.pinchGestureRecognizer?.isEnabled = false
    web.scrollView.delegate = still
    web.configuration.userContentController.add(themes, name: "buckyTheme")
    Keyboard.leave(web)
    self.container = container
    apply(UserDefaults.standard.string(forKey: Self.themeKey))
    // The page may have been there first.
    web.evaluateJavaScript("window.dispatchEvent(new Event(\"native-ready\"))")
    back = BackGesture(container)
    // Only a video in fullscreen turns.
    controller?.setValue(UIInterfaceOrientationMask.portrait.rawValue, forKey: "supportedInterfaceOrientations")

    let center = NotificationCenter.default
    for name in [UIResponder.keyboardWillChangeFrameNotification, UIResponder.keyboardWillHideNotification] {
      center.addObserver(self, selector: #selector(keyboardChanged), name: name, object: nil)
    }
    center.addObserver(self, selector: #selector(resigned), name: UIApplication.willResignActiveNotification, object: nil)
    center.addObserver(self, selector: #selector(activated), name: UIApplication.didBecomeActiveNotification, object: nil)
    network.pathUpdateHandler = { path in
      DispatchQueue.main.async { Client.shared.networkChanged(path) }
    }
    network.start(queue: .global(qos: .utility))
  }

  private lazy var still = StillScroll()
  private lazy var themes = ThemeMessages { [weak self] theme in
    UserDefaults.standard.set(theme, forKey: Self.themeKey)
    self?.apply(theme)
  }

  private static let themeKey = "client-theme"

  /// The client's theme; kept, so that a start does not begin in the system's.
  private func apply(_ theme: String?) {
    let window = container?.window ?? controller?.view.window
    window?.overrideUserInterfaceStyle = theme == "light" ? .light : theme == "dark" ? .dark : .unspecified
  }

  private var controller: UIViewController? {
    var responder: UIResponder? = container
    while let next = responder?.next {
      if let controller = next as? UIViewController { return controller }
      responder = next
    }
    return nil
  }

  /// Where a question of a view is shown; nowhere while the user does not look at it.
  func presenter(for view: ContentView) -> UIViewController? {
    if view.gone || shown != view.id { return nil }
    return top
  }

  private var top: UIViewController? {
    var top = controller
    while let next = top?.presentedViewController, !next.isBeingDismissed { top = next }
    return top
  }

  @objc private func resigned() {
    Native.event("paused")
  }

  @objc private func activated() {
    Native.event("resumed")
  }

  private func networkChanged(_ path: NWPath) {
    // The first answer says what is, not what changed.
    defer { settled = true }
    if settled && path.status == .satisfied { Native.event("online") }
  }

  // ---- the keyboard ----

  @objc private func keyboardChanged(_ notification: Notification) {
    guard let container else { return }
    let change = Keyboard.change(notification, in: container)
    keyboard = change.covered
    UIView.animate(withDuration: change.duration, delay: 0, options: change.options) {
      self.place()
    } completion: { _ in
      self.revealInput()
    }
    let covered = container.mainHost.web.holdsFirstResponder ? keyboard : 0
    container.mainHost.web.evaluateJavaScript(
      """
      (() => {
        const root = document.documentElement;
        const value = "\(covered)px";
        if (root.style.getPropertyValue("--keyboard-inset-bottom") === value) return;
        root.style.setProperty("--keyboard-inset-bottom", value);
        window.dispatchEvent(new CustomEvent("window-insets-change"));
      })()
      """)
  }

  /// What is typed into stays in sight when the keyboard takes its place.
  private func revealInput() {
    guard keyboard > 0, let view = shown.flatMap({ views[$0] }), view.web.holdsFirstResponder else { return }
    view.web.evaluateJavaScript("document.activeElement && document.activeElement.scrollIntoView({ block: \"nearest\" })")
  }

  // ---- views ----

  private func place() {
    guard let container, let view = shown.flatMap({ views[$0] }) else { return }
    var bottom = stage.maxY
    // Only for typing in the page: the local pages deal with their own keyboard.
    if keyboard > 0 && view.web.holdsFirstResponder { bottom = min(bottom, container.bounds.maxY - keyboard) }
    let frame = CGRect(x: stage.minX, y: stage.minY, width: stage.width, height: max(0, bottom - stage.minY))
    if view.web.frame != frame { view.web.frame = frame }
  }

  private func arguments(_ invoke: Invoke) -> [String: Any] {
    let data = Data(invoke.getRawArgs().utf8)
    return (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
  }

  private func rect(_ json: Any?) -> CGRect {
    let values = json as? [String: Any] ?? [:]
    let number = { (key: String) -> CGFloat in CGFloat((values[key] as? NSNumber)?.doubleValue ?? 0) }
    return CGRect(x: number("x"), y: number("y"), width: number("width"), height: number("height"))
  }

  private func view(_ arguments: [String: Any], _ key: String = "id") -> ContentView? {
    (arguments[key] as? String).flatMap { views[$0] }
  }

  private func url(_ arguments: [String: Any]) -> URL? {
    (arguments["url"] as? String).flatMap { URL(string: $0) }
  }

  func create(_ invoke: Invoke) {
    let args = arguments(invoke)
    guard let container = self.container, let id = args["id"] as? String, let profile = args["profile"] as? String else {
      invoke.reject("not ready")
      return
    }
    drop(id)
    let view = ContentView(
      client: self, id: id, profile: profile, zoneHost: (args["zoneHost"] as? String ?? "").lowercased(),
      label: args["label"] as? String ?? "", rules: args["rules"] as? [String] ?? [], script: args["script"] as? String ?? "")
    views[id] = view
    view.web.frame = container.contentHost.bounds
    invoke.resolve()
  }

  func load(_ invoke: Invoke) {
    let args = arguments(invoke)
    guard let view = view(args), let url = url(args) else {
      invoke.reject("no such view")
      return
    }
    view.load(url)
    invoke.resolve()
  }

  func goTo(_ invoke: Invoke) {
    let args = arguments(invoke)
    if let url = url(args) { view(args)?.go(to: url) }
    invoke.resolve()
  }

  func close(_ invoke: Invoke) {
    if let id = arguments(invoke)["id"] as? String { self.drop(id) }
    invoke.resolve()
  }

  private func drop(_ id: String) {
    if shown == id { conceal() }
    views.removeValue(forKey: id)?.destroy()
    for (key, reply) in replies where reply.view == id {
      replies.removeValue(forKey: key)
      reply.answer(nil, "closed")
    }
  }

  /// The process of a view is gone, and the view with it.
  func dropped(_ view: ContentView) {
    if views[view.id] === view { drop(view.id) }
  }

  private func conceal() {
    shown.flatMap { views[$0] }?.hide()
    shown = nil
    container?.mainHost.pass = nil
  }

  func show(_ invoke: Invoke) {
    let args = arguments(invoke)
    if let color = (args["background"] as? String).flatMap({ UIColor(hex: $0) }) { self.container?.backgroundColor = color }
    let id = args["view"] as? String
    if let id, let view = self.views[id], let container = self.container {
      self.stage = rect(args["rect"])
      if self.shown != id {
        self.shown.flatMap { self.views[$0] }?.hide()
        self.shown = id
        view.show(in: container.contentHost)
      }
      container.mainHost.pass = self.stage
      self.place()
    } else {
      self.conceal()
    }
    invoke.resolve()
  }

  func overlay(_ invoke: Invoke) {
    let args = arguments(invoke)
    let blocks = (args["blocks"] as? [Any] ?? []).map { rect($0) }
    self.container?.overlay(modal: args["modal"] as? Bool ?? false, blocks: blocks)
    invoke.resolve()
  }

  func eval(_ invoke: Invoke) {
    let args = arguments(invoke)
    if let script = args["script"] as? String { view(args)?.web.evaluateJavaScript(script) }
    invoke.resolve()
  }

  func back(_ invoke: Invoke) {
    invoke.resolve(["moved": view(arguments(invoke))?.back() ?? false])
  }

  func stop(_ invoke: Invoke) {
    view(arguments(invoke))?.stop()
    invoke.resolve()
  }

  /// iOS apps do not go to the background by themselves.
  func toBackground(_ invoke: Invoke) {
    invoke.resolve()
  }

  // ---- the bridge ----

  func wait(_ answer: @escaping (Any?, String?) -> Void, of view: String) -> Int64 {
    let id = nextReply
    nextReply += 1
    replies[id] = (view, answer)
    return id
  }

  func reply(_ invoke: Invoke) {
    let args = arguments(invoke)
    if let id = (args["replyId"] as? NSNumber)?.int64Value { self.replies.removeValue(forKey: id)?.answer(args["json"] as? String, nil) }
    invoke.resolve()
  }

  // ---- cookies and storage ----

  func getCookies(_ invoke: Invoke) {
    let args = arguments(invoke)
    guard let url = url(args), let profile = args["profile"] as? String else {
      invoke.reject("no address")
      return
    }
    Profiles.cookies(profile, url) { invoke.resolve(["cookies": $0]) }
  }

  func setCookies(_ invoke: Invoke) {
    let args = arguments(invoke)
    guard let url = url(args), let profile = args["profile"] as? String else {
      invoke.reject("no address")
      return
    }
    Profiles.setCookies(profile, url, args["cookies"] as? [String] ?? []) { invoke.resolve() }
  }

  func clearProfile(_ invoke: Invoke) {
    Profiles.clear(arguments(invoke)["profile"] as? String ?? "") { invoke.resolve() }
  }

  // ---- questions ----

  private struct Password: Encodable {
    let password: String?
  }

  func signPrompt(_ invoke: Invoke) {
    let args = arguments(invoke)
    if args["wrong"] as? Bool == true {
      guard let prompt = self.signPrompt else {
        invoke.reject("closed")
        return
      }
      self.signInvoke = invoke
      prompt.wrong()
      return
    }
    self.signPrompt?.close()
    guard let top = self.top else {
      invoke.reject("not ready")
      return
    }
    self.signInvoke = invoke
    let labels = Labels.load()
    let text = { (key: String) -> String in args[key] as? String ?? "" }
    let question = (args["device"] as? Bool == true ? labels.signDevice : labels.signAsk)
      .filled(["zone": text("zone"), "app": text("app")])
    let identity = labels.signIdentity.filled(["app": text("identity")])
    let prompt = SignPrompt(message: "\(question)\n\n\(identity)", content: text("content")) { password in
      let waiting = self.signInvoke
      self.signInvoke = nil
      if password == nil { self.signPrompt = nil }
      waiting?.resolve(Password(password: password))
    }
    self.signPrompt = prompt
    top.present(prompt, animated: true)
  }

  func signDone(_ invoke: Invoke) {
    self.signPrompt?.close()
    self.signPrompt = nil
    self.signInvoke?.resolve(Password(password: nil))
    self.signInvoke = nil
    invoke.resolve()
  }

  func askMicrophone(_ invoke: Invoke) {
    guard let view = view(arguments(invoke), "view") else {
      invoke.resolve(["granted": false])
      return
    }
    view.askMicrophone { invoke.resolve(["granted": $0]) }
  }

  // ---- the system ----

  func status(_ invoke: Invoke) {
    invoke.resolve([
      "batteryUnrestricted": true, "serviceRunning": false, "multiProfile": true, "webview": UIDevice.current.systemVersion,
    ])
  }

  func openSettings(_ invoke: Invoke) {
    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
    invoke.resolve()
  }

  /// A downloaded file, to the system's share sheet.
  func share(_ invoke: Invoke) {
    if let top = self.top { Downloads.share(arguments(invoke)["path"] as? String ?? "", on: top) }
    invoke.resolve()
  }

  // ---- audio ----

  func playback(_ invoke: Invoke) {
    do {
      try self.playing.update(arguments(invoke)["item"] as? [String: Any])
      for (id, view) in self.views { view.setPlaying(id == self.playing.view) }
      invoke.resolve()
    } catch {
      invoke.reject(error.localizedDescription, code: "denied")
    }
  }

  func record(_ invoke: Invoke) {
    let args = arguments(invoke)
    let number = { (key: String, fallback: Double) -> Double in (args[key] as? NSNumber)?.doubleValue ?? fallback }
    let failed = { (failure: Recorder.Failure) in invoke.reject(failure.message, code: failure.code) }
    let simple = { (result: Result<Void, Recorder.Failure>) in
      switch result {
      case .success: invoke.resolve()
      case .failure(let failure): failed(failure)
      }
    }
    switch args["action"] as? String {
    case "start":
      let path = args["path"] as? String ?? ""
      let (rate, channels, bits) = (number("sampleRate", 44100), Int(number("channels", 1)), Int(number("bitRate", 96000)))
      recorder.run({ try $0.start(path: path, sampleRate: rate, channels: channels, bitRate: bits) }, done: simple)
    case "pause":
      recorder.run({ try $0.pause() }, done: simple)
    case "resume":
      recorder.run({ try $0.resume() }, done: simple)
    case "stop":
      recorder.run({ try $0.stop() }) { result in
        switch result {
        case .success(let length): invoke.resolve(["durationMs": length])
        case .failure(let failure): failed(failure)
        }
      }
    default:
      recorder.run({ $0.status }) { result in
        if case .success(let status) = result { invoke.resolve(["state": status.state, "elapsedMs": status.elapsedMs]) }
      }
    }
  }
}

/// The local pages stay where they are.
private final class StillScroll: NSObject, UIScrollViewDelegate {
  func scrollViewDidScroll(_ scrollView: UIScrollView) {
    if scrollView.contentOffset != .zero { scrollView.contentOffset = .zero }
  }

  func viewForZooming(in scrollView: UIScrollView) -> UIView? { nil }
}

/// The theme the user chose in the client: `light`, `dark`, or the system's.
private final class ThemeMessages: NSObject, WKScriptMessageHandler {
  private let changed: (String) -> Void

  init(changed: @escaping (String) -> Void) {
    self.changed = changed
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    if message.frameInfo.isMainFrame, let theme = message.body as? String { changed(theme) }
  }
}
