import UIKit
import WebKit

/// The keyboard. A WebView would move its page out from under it, and what this client puts over
/// and under one another would no longer fit; instead the local pages are told how much is covered,
/// and a content view ends where the keyboard begins.
@MainActor
enum Keyboard {
  static func leave(_ web: WKWebView) {
    let center = NotificationCenter.default
    for name in [
      UIResponder.keyboardWillShowNotification, UIResponder.keyboardDidShowNotification, UIResponder.keyboardWillHideNotification,
      UIResponder.keyboardDidHideNotification, UIResponder.keyboardWillChangeFrameNotification,
      UIResponder.keyboardDidChangeFrameNotification,
    ] {
      center.removeObserver(web, name: name, object: nil)
    }
  }

  /// How much of a view's lower end is covered after the change, and how it changes.
  static func change(_ notification: Notification, in view: UIView) -> (covered: CGFloat, duration: TimeInterval, options: UIView.AnimationOptions) {
    let info = notification.userInfo ?? [:]
    let duration = (info[UIResponder.keyboardAnimationDurationUserInfoKey] as? NSNumber)?.doubleValue ?? 0
    let curve = (info[UIResponder.keyboardAnimationCurveUserInfoKey] as? NSNumber)?.uintValue ?? 0
    var covered: CGFloat = 0
    if notification.name != UIResponder.keyboardWillHideNotification,
      let end = (info[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue, let window = view.window
    {
      let frame = view.convert(window.convert(end, from: window.screen.coordinateSpace), from: window)
      covered = max(0, view.bounds.maxY - frame.minY)
    }
    return (covered, duration, UIView.AnimationOptions(rawValue: curve << 16))
  }
}
