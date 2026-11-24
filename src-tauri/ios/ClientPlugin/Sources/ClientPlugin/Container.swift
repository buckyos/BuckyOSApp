import UIKit
import WebKit

/// The local pages (the main WebView), transparent where a content view shows through. Touches that
/// begin there are left to the content view below.
final class MainHost: UIView {
  var pass: CGRect?
  var blocks: [CGRect] = []
  var modal = false
  let web: WKWebView

  init(web: WKWebView) {
    self.web = web
    super.init(frame: .zero)
    addSubview(web)
    web.autoresizingMask = []
  }

  required init?(coder: NSCoder) {
    fatalError("not from a nib")
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    if web.frame != bounds { web.frame = bounds }
  }

  private func passes(_ point: CGPoint) -> Bool {
    if modal { return false }
    guard let pass, pass.contains(point) else { return false }
    return !blocks.contains { $0.contains(point) }
  }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    passes(point) ? nil : super.hitTest(point, with: event)
  }
}

/// Content views below, the local pages above.
final class ContainerView: UIView {
  let contentHost = UIView()
  let mainHost: MainHost

  init(web: WKWebView, frame: CGRect) {
    mainHost = MainHost(web: web)
    super.init(frame: frame)
    autoresizingMask = [.flexibleWidth, .flexibleHeight]
    for host in [contentHost, mainHost] {
      host.frame = bounds
      host.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      addSubview(host)
    }
  }

  required init?(coder: NSCoder) {
    fatalError("not from a nib")
  }

  /// A screen reader gets what the touches get.
  func overlay(modal: Bool, blocks: [CGRect]) {
    mainHost.modal = modal
    mainHost.blocks = blocks
    contentHost.accessibilityElementsHidden = modal
  }
}

extension UIView {
  var holdsFirstResponder: Bool {
    isFirstResponder || subviews.contains { $0.holdsFirstResponder }
  }
}

extension UIColor {
  /// The ground of the local pages (`--cp-bg`).
  static let ground = UIColor { traits in
    traits.userInterfaceStyle == .dark
      ? UIColor(red: 0x14 / 255, green: 0x14 / 255, blue: 0x15 / 255, alpha: 1)
      : UIColor(red: 0xf3 / 255, green: 0xf3 / 255, blue: 0xf2 / 255, alpha: 1)
  }

  /// `#rrggbb`.
  convenience init?(hex: String) {
    guard hex.hasPrefix("#"), hex.count == 7, let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
    self.init(
      red: CGFloat(value >> 16 & 0xff) / 255, green: CGFloat(value >> 8 & 0xff) / 255, blue: CGFloat(value & 0xff) / 255, alpha: 1)
  }
}
