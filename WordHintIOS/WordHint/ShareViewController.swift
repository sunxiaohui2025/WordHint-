import UIKit
import Social
import UniformTypeIdentifiers

final class ShareViewController: SLComposeServiceViewController {
    override func isContentValid() -> Bool { true }

    override func didSelectPost() {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem else {
            extensionContext?.completeRequest(returningItems: [], completionHandler: nil); return
        }
        let group = UserDefaults(suiteName: "group.com.sun.wordhint")
        let dispatchGroup = DispatchGroup()
        var pending = (group?.array(forKey: "pendingShares") as? [[String: Any]]) ?? []
        for provider in item.attachments ?? [] {
            let type = provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) ? UTType.plainText.identifier : UTType.url.identifier
            guard provider.hasItemConformingToTypeIdentifier(type) else { continue }
            dispatchGroup.enter()
            provider.loadItem(forTypeIdentifier: type, options: nil) { value, _ in
                defer { dispatchGroup.leave() }
                let text = (value as? String) ?? (value as? URL)?.absoluteString
                guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
                pending.append(["text": text, "kind": type == UTType.url.identifier ? "url" : "text"])
            }
            break
        }
        dispatchGroup.notify(queue: .main) { [weak self] in
            group?.set(pending, forKey: "pendingShares")
            self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        }
    }

    override func configurationItems() -> [Any]! { [] }
}
