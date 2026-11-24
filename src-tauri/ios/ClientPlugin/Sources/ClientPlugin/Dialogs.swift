import AVFoundation
import UIKit

/// The system's permission to record, asked when it is needed.
enum Microphone {
  static func request(_ done: @escaping (Bool) -> Void) {
    AVAudioApplication.requestRecordPermission { granted in
      DispatchQueue.main.async { done(granted) }
    }
  }
}

/// Questions a page must not be able to draw, read or answer by itself.
@MainActor
enum Dialogs {
  static func askMicrophone(on presenter: UIViewController, app: String, zone: String, done: @escaping (Bool) -> Void) {
    let labels = Labels.load()
    let alert = UIAlertController(title: nil, message: labels.micAsk.filled(["app": app, "zone": zone]), preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: labels.deny, style: .cancel) { _ in done(false) })
    alert.addAction(UIAlertAction(title: labels.allow, style: .default) { _ in done(true) })
    presenter.present(alert, animated: true)
  }

  /// `alert`, `confirm` and `prompt` of a page, with the name of who asks.
  @MainActor
  final class Page {
    let controller: UIAlertController
    var ended: (() -> Void)?
    private var answer: ((Bool, String?) -> Void)?

    fileprivate init(title: String, message: String, answer: @escaping (Bool, String?) -> Void) {
      controller = UIAlertController(title: title, message: message, preferredStyle: .alert)
      self.answer = answer
    }

    fileprivate func finish(_ accepted: Bool, _ text: String?) {
      guard let answer else { return }
      self.answer = nil
      ended?()
      answer(accepted, text)
    }

    /// The page is gone, and its question with it.
    func close() {
      controller.presentingViewController?.dismiss(animated: false)
      finish(false, nil)
    }
  }

  static func page(
    title: String, message: String, field: String?, cancel: Bool, answer: @escaping (Bool, String?) -> Void
  ) -> Page {
    let labels = Labels.load()
    let page = Page(title: title, message: message, answer: answer)
    if let field {
      page.controller.addTextField { $0.text = field }
    }
    if cancel {
      page.controller.addAction(UIAlertAction(title: labels.cancel, style: .cancel) { _ in page.finish(false, nil) })
    }
    page.controller.addAction(
      UIAlertAction(title: labels.confirm, style: .default) { _ in page.finish(true, page.controller.textFields?.first?.text) })
    return page
  }
}

/// Neither filled in from the system's passwords nor saved there.
private final class WalletPasswordField: UITextField {
  override func buildMenu(with builder: UIMenuBuilder) {
    super.buildMenu(with: builder)
    builder.remove(menu: .autoFill)
  }
}

/// The wallet password for a signature a page asked for. It stays open while a password is tried:
/// `wrong` puts it back to the user, `close` ends it.
final class SignPrompt: UIViewController, UITextFieldDelegate {
  private let labels = Labels.load()
  private let message: String
  private let content: String
  private var answer: ((String?) -> Void)?
  private let password = WalletPasswordField()
  private let error = UILabel()
  private let confirm = UIButton(type: .system)
  private let busy = UIActivityIndicatorView(style: .medium)

  init(message: String, content: String, answer: @escaping (String?) -> Void) {
    self.message = message
    self.content = content
    self.answer = answer
    super.init(nibName: nil, bundle: nil)
    // Only its buttons end it.
    isModalInPresentation = true
    modalPresentationStyle = .pageSheet
  }

  required init?(coder: NSCoder) {
    fatalError("not from a nib")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground

    let title = UILabel()
    title.text = labels.signTitle
    title.font = .preferredFont(forTextStyle: .headline)
    title.accessibilityTraits = .header

    let question = UILabel()
    question.text = message
    question.numberOfLines = 0
    question.font = .preferredFont(forTextStyle: .subheadline)
    question.setContentCompressionResistancePriority(.required, for: .vertical)

    let text = UITextView()
    text.text = content
    text.isEditable = false
    text.isSelectable = true
    text.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
    text.backgroundColor = .secondarySystemBackground
    text.layer.cornerRadius = 8
    text.textContainerInset = UIEdgeInsets(top: 8, left: 6, bottom: 8, right: 6)
    text.accessibilityIdentifier = "sign-content"
    text.setContentHuggingPriority(.defaultLow, for: .vertical)

    password.placeholder = labels.signPassword
    password.isSecureTextEntry = true
    password.textContentType = .oneTimeCode
    password.autocorrectionType = .no
    password.autocapitalizationType = .none
    password.spellCheckingType = .no
    password.smartInsertDeleteType = .no
    password.borderStyle = .roundedRect
    password.returnKeyType = .done
    password.delegate = self
    password.accessibilityIdentifier = "sign-password"

    error.textColor = .systemRed
    error.font = .preferredFont(forTextStyle: .footnote)
    error.numberOfLines = 0
    error.isHidden = true

    let cancel = UIButton(type: .system)
    cancel.setTitle(labels.cancel, for: .normal)
    cancel.addAction(UIAction { [weak self] _ in self?.finish() }, for: .touchUpInside)
    confirm.setTitle(labels.confirm, for: .normal)
    confirm.titleLabel?.font = .preferredFont(forTextStyle: .headline)
    confirm.addAction(UIAction { [weak self] _ in self?.submit() }, for: .touchUpInside)
    for button in [cancel, confirm] {
      button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    }
    let buttons = UIStackView(arrangedSubviews: [cancel, UIView(), busy, confirm])
    buttons.spacing = 12

    let stack = UIStackView(arrangedSubviews: [title, question, text, password, error, buttons])
    stack.axis = .vertical
    stack.spacing = 12
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)
    let height = text.heightAnchor.constraint(equalToConstant: 200)
    height.priority = .defaultLow
    NSLayoutConstraint.activate([
      stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 20),
      stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20),
      stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20),
      stack.bottomAnchor.constraint(lessThanOrEqualTo: view.keyboardLayoutGuide.topAnchor, constant: -8),
      text.heightAnchor.constraint(greaterThanOrEqualToConstant: 60),
      text.heightAnchor.constraint(lessThanOrEqualToConstant: 320),
      height,
    ])
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    password.becomeFirstResponder()
  }

  func textFieldShouldReturn(_ textField: UITextField) -> Bool {
    submit()
    return false
  }

  private func enable(_ enabled: Bool) {
    password.isEnabled = enabled
    confirm.isEnabled = enabled
    if enabled { busy.stopAnimating() } else { busy.startAnimating() }
  }

  private func submit() {
    let value = password.text ?? ""
    guard !value.isEmpty, confirm.isEnabled, let answer else { return }
    enable(false)
    error.isHidden = true
    answer(value)
  }

  private func finish() {
    guard let answer else { return }
    self.answer = nil
    password.text = nil
    presentingViewController?.dismiss(animated: true)
    answer(nil)
  }

  func wrong() {
    error.text = labels.signWrong
    error.isHidden = false
    password.text = nil
    enable(true)
    password.becomeFirstResponder()
    UIAccessibility.post(notification: .announcement, argument: labels.signWrong)
  }

  func close() {
    answer = nil
    password.text = nil
    presentingViewController?.dismiss(animated: true)
  }
}
