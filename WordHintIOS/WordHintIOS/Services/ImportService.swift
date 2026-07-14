import Foundation
import SwiftData

@MainActor
enum ImportService {
    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        return decoder
    }()

    static func decode(_ data: Data) throws -> ChromeBackup {
        if let backup = try? decoder.decode(ChromeBackup.self, from: data) { return backup }
        if let words = try? decoder.decode([ChromeWord].self, from: data) { return ChromeBackup(wordbook: words) }
        throw CocoaError(.fileReadCorruptFile, userInfo: [NSLocalizedDescriptionKey: "不是有效的 WordHint JSON 备份"])
    }

    static func importData(_ data: Data, into context: ModelContext) throws -> ImportReport {
        let backup = try decode(data)
        let existing = try context.fetch(FetchDescriptor<Word>())
        var byKey = Dictionary(uniqueKeysWithValues: existing.map { ($0.normalizedWord, $0) })
        let ignored = Set((backup.whitelist ?? []).map(Word.normalize))
        var report = ImportReport(ignored: ignored.count)

        // Chrome whitelist is preserved as ignored words, not discarded.
        for key in ignored where !key.isEmpty {
            if let current = byKey[key] {
                current.statusRaw = LearningStatus.ignored.rawValue
            } else {
                let word = Word(word: key)
                word.statusRaw = LearningStatus.ignored.rawValue
                context.insert(word)
                byKey[key] = word
            }
        }

        for item in backup.wordbook {
            let key = Word.normalize(item.word)
            guard !key.isEmpty, !ignored.contains(key) else { report.skipped += 1; continue }
            if let current = byKey[key] {
                // Imported non-empty values win; memory history is never reset.
                if let value = item.meaning, !value.isEmpty { current.meaning = value }
                if let value = item.sentence, !value.isEmpty { current.sentence = value }
                if let value = item.generatedSentence, !value.isEmpty { current.generatedSentence = value }
                current.lemma = item.lemma ?? current.lemma
                current.partOfSpeech = item.partOfSpeech ?? current.partOfSpeech
                current.phonetic = item.phonetic ?? current.phonetic
                current.englishDefinition = item.englishDefinition ?? current.englishDefinition
                current.sourceURL = item.sourceURL ?? current.sourceURL
                current.updatedAt = .now
                report.updated += 1
            } else {
                let word = Word(word: item.word, meaning: item.meaning ?? "", sentence: item.sentence ?? "", addedAt: parseDate(item.time) ?? .now)
                word.lemma = item.lemma; word.partOfSpeech = item.partOfSpeech; word.phonetic = item.phonetic
                word.englishDefinition = item.englishDefinition; word.sourceURL = item.sourceURL
                word.generatedSentence = item.generatedSentence
                context.insert(word); byKey[key] = word; report.inserted += 1
            }
        }
        try context.save()
        return report
    }

    static func initializeBundledDictionary(into context: ModelContext) throws {
        let count = try context.fetchCount(FetchDescriptor<Word>())
        guard count == 0, let url = Bundle.main.url(forResource: "word_dict", withExtension: "json", subdirectory: "WordLibraries") ?? Bundle.main.url(forResource: "word_dict", withExtension: "json") else { return }
        let dict = try JSONDecoder().decode([String: String].self, from: Data(contentsOf: url))
        // The dictionary is reference data, not a study list. Insert only when the user opts in later.
        UserDefaults.standard.set(dict.count, forKey: "bundledDictionaryCount")
    }

    private static func parseDate(_ value: String?) -> Date? {
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter()
        return formatter.date(from: value)
    }
}
