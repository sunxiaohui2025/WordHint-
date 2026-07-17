import UIKit
import Social
import UniformTypeIdentifiers

final class ShareViewController: SLComposeServiceViewController {
    override func isContentValid() -> Bool { true }

    override func didSelectPost() {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem else {
            extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            return
        }

        let group = UserDefaults(suiteName: "group.com.sun.wordhint")
        let queue = DispatchGroup()
        var pending = (group?.array(forKey: "pendingShares") as? [[String: Any]]) ?? []

        for provider in item.attachments ?? [] {
            let type: String
            if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                type = UTType.plainText.identifier
            } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                type = UTType.url.identifier
            } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                type = UTType.image.identifier
            } else {
                continue
            }

            queue.enter()
            provider.loadItem(forTypeIdentifier: type, options: nil) { value, _ in
                defer { queue.leave() }
                var text: String?
                var kind = "text"
                if let string = value as? String {
                    text = string
                } else if let url = value as? URL {
                    text = url.absoluteString
                    kind = "url"
                } else if let image = value as? UIImage,
                          let data = image.jpegData(compressionQuality: 0.85) {
                    let filename = "shared-\(UUID().uuidString).jpg"
                    let directory = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.sun.wordhint")
                    let fileURL = directory?.appendingPathComponent(filename)
                    if let fileURL { try? data.write(to: fileURL); text = fileURL.lastPathComponent }
                    kind = "image"
                }
                guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
                pending.append(["text": text, "kind": kind, "createdAt": Date().timeIntervalSince1970])
            }
            break
        }

        queue.notify(queue: .main) { [weak self] in
            group?.set(pending, forKey: "pendingShares")
            self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        }
    }

    override func configurationItems() -> [Any]! { [] }
}
