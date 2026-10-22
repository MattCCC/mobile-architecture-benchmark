import UIKit

/// Fatal app-level error screen (design §8.1).
final class ErrorViewController: UIViewController {
    private let code: String

    init(code: String) {
        self.code = code
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Palette.background
        view.accessibilityIdentifier = "mb.screen.error"
        let label = UILabel()
        label.font = Fonts.label
        label.textColor = Palette.text
        label.text = "Error: \(code)"
        label.accessibilityIdentifier = "mb.error.code"
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
        ])
    }
}
