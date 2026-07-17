import Foundation
import SwiftData

enum SharedShareInbox {
    static let groupID = "group.com.sun.wordhint"
    private static let key = "pendingShares"

    @MainActor
    static func importPending(into context: ModelContext) {
        guard let defaults = UserDefaults(suiteName: groupID),
              let values = defaults.array(forKey: key) as? [[String: Any]], !values.isEmpty else { return }
        let words = (try? context.fetch(FetchDescriptor<Word>())) ?? []
        for value in values {
            guard let text = value["text"] as? String else { continue }
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }
            let url = URL(string: trimmed)
            let candidate = trimmed.split { !$0.isLetter && !$0.isNumber && $0 != "'" && $0 != "-" }.first.map(String.init) ?? trimmed
            let wordText = candidate.trimmingCharacters(in: .punctuationCharacters)
            guard !wordText.isEmpty else { continue }
            let normalized = Word.normalize(wordText)
            let item = words.first { $0.normalizedWord == normalized } ?? Word(word: wordText, sentence: url == nil ? trimmed : "")
            if !words.contains(where: { $0 === item }) { context.insert(item) }
            if url == nil { item.sentence = trimmed } else { item.sourceURL = url?.absoluteString }
            item.updatedAt = .now
        }
        try? context.save()
        defaults.removeObject(forKey: key)
    }
}
