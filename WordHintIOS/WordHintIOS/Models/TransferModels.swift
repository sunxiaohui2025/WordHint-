import Foundation

struct ChromeBackup: Codable, Sendable {
    var version: String?
    var exportDate: String?
    var schemaVersion: Int?
    var whitelist: [String]?
    var wordbook: [ChromeWord]
}

struct ChromeWord: Codable, Sendable {
    let word: String
    var meaning: String?
    var sentence: String?
    var generatedSentence: String?
    var time: String?
    var lemma: String?
    var partOfSpeech: String?
    var phonetic: String?
    var englishDefinition: String?
    var sourceURL: String?
}

struct ImportReport: Codable, Sendable {
    var inserted = 0
    var updated = 0
    var skipped = 0
    var ignored = 0
}
