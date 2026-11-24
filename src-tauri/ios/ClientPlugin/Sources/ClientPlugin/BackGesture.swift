import UIKit
import WebKit

/// Back, by a drag from the left edge. iOS has no back button; what back means is the local page's
/// to know (`BackStack`), which is also asked whether there is anything to go back to.
@MainActor
final class BackGesture: NSObject, UIGestureRecognizerDelegate {
  private static let needed: CGFloat = 64
  private weak var container: ContainerView?
  private let recognizer = UIScreenEdgePanGestureRecognizer()
  private let bubble = UIVisualEffectView(effect: UIBlurEffect(style: .systemMaterial))
  private let arrow = UIImageView(image: UIImage(systemName: "chevron.left"))
  private let feedback = UIImpactFeedbackGenerator(style: .light)
  private var available = false
  private var armed = false

  init(_ container: ContainerView) {
    self.container = container
    super.init()
    recognizer.edges = .left
    recognizer.delegate = self
    recognizer.addTarget(self, action: #selector(moved))
    container.addGestureRecognizer(recognizer)
    container.escape = { [weak self] in self?.go() }
    bubble.frame = CGRect(x: 0, y: 0, width: 40, height: 40)
    bubble.layer.cornerRadius = 20
    bubble.clipsToBounds = true
    bubble.alpha = 0
    bubble.isUserInteractionEnabled = false
    bubble.isAccessibilityElement = false
    arrow.tintColor = .label
    arrow.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 16, weight: .semibold)
    arrow.sizeToFit()
    arrow.center = CGPoint(x: 19, y: 20)
    bubble.contentView.addSubview(arrow)
    container.addSubview(bubble)
  }

  @objc private func moved() {
    guard let container else { return }
    let distance = max(0, recognizer.translation(in: container).x)
    switch recognizer.state {
    case .began:
      available = false
      armed = false
      feedback.prepare()
      let height = recognizer.location(in: container).y
      container.mainHost.web.evaluateJavaScript("Boolean(window.__buckyBack && window.__buckyBack.available())") { [weak self] answer, _ in
        guard let self, (answer as? Bool) == true, self.recognizer.state == .began || self.recognizer.state == .changed else { return }
        self.available = true
        self.follow(max(0, self.recognizer.translation(in: container).x), height)
      }
    case .changed:
      follow(distance, recognizer.location(in: container).y)
    case .ended:
      let fast = recognizer.velocity(in: container).x > 500 && distance > 24
      let back = distance >= Self.needed || fast
      hide()
      if back { go() }
    default:
      hide()
    }
  }

  private func go() {
    container?.mainHost.web.evaluateJavaScript("window.__buckyBack && window.__buckyBack.go()")
  }

  private func follow(_ distance: CGFloat, _ height: CGFloat) {
    guard available, let container else { return }
    let progress = min(1, distance / Self.needed)
    container.bringSubviewToFront(bubble)
    bubble.alpha = progress
    bubble.center = CGPoint(
      x: -20 + progress * 44, y: min(max(height, container.safeAreaInsets.top + 24), container.bounds.maxY - container.safeAreaInsets.bottom - 24))
    if (progress >= 1) != armed {
      armed.toggle()
      if armed { feedback.impactOccurred() }
      bubble.transform = armed ? CGAffineTransform(scaleX: 1.15, y: 1.15) : .identity
    }
  }

  private func hide() {
    available = false
    UIView.animate(withDuration: 0.18) {
      self.bubble.alpha = 0
      self.bubble.transform = .identity
      self.bubble.center.x = -20
    }
  }

  /// A page's own drag waits: what begins at the edge is back.
  func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
    other is UIPanGestureRecognizer
  }
}
