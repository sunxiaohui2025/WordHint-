import Foundation
import SwiftData

enum LearningStatus: String, Codable, CaseIterable, Identifiable {
    case new, learning, due, weak, mastered, ignored
    var id: String { rawValue }
    var title: String {
        switch self { case .new: "新词"; case .learning: "学习中"; case .due: "待复习"; case .weak: "薄弱词"; case .mastered: "已掌握"; case .ignored: "已忽略" }
    }
}

@Model
final class Word {
    @Attribute(.unique) var normalizedWord: String
    var word: String
    var meaning: String
    var sentence: String
    // AI-generated complete example for practice; sentence remains the original web context.
    var generatedSentence: String?
    var addedAt: Date
    // Optional so existing on-device SwiftData stores can migrate without data loss.
    var updatedAt: Date?

    // Optional enrichment fields. The four fields above map 1:1 to Chrome wordbook.
    var lemma: String?
    var partOfSpeech: String?
    var phonetic: String?
    var englishDefinition: String?
    var sourceURL: String?
    var note: String
    var statusRaw: String

    var repetitions: Int
    var intervalDays: Int
    var easeFactor: Double
    var lapseCount: Int
    var lastReviewedAt: Date?
    var nextReviewAt: Date

    init(word: String, meaning: String = "", sentence: String = "", addedAt: Date = .now) {
        self.word = word.trimmingCharacters(in: .whitespacesAndNewlines)
        normalizedWord = Self.normalize(word)
        self.meaning = meaning
        self.sentence = sentence
        self.addedAt = addedAt
        updatedAt = addedAt
        note = ""
        statusRaw = LearningStatus.new.rawValue
        repetitions = 0
        intervalDays = 0
        easeFactor = 2.5
        lapseCount = 0
        nextReviewAt = addedAt
    }

    var status: LearningStatus {
        get {
            // Explicit user choices take priority over the calculated SM-2 state.
            if let explicit = LearningStatus(rawValue: statusRaw), explicit != .learning { return explicit }
            if repetitions >= 5 && intervalDays >= 30 { return .mastered }
            if lapseCount >= 3 { return .weak }
            if repetitions == 0 { return .new }
            if nextReviewAt <= .now { return .due }
            return .learning
        }
        set { statusRaw = newValue.rawValue; updatedAt = .now }
    }

    static func normalize(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}

@Model
final class StudySession {
    var date: Date
    var reviewed: Int
    var correct: Int
    var newWords: Int
    init(date: Date = .now, reviewed: Int = 0, correct: Int = 0, newWords: Int = 0) {
        self.date = date; self.reviewed = reviewed; self.correct = correct; self.newWords = newWords
    }
}

@Model
final class GeneratedArticle {
    @Attribute(.unique) var id: UUID
    var title: String
    var english: String
    var chinese: String
    var targetWordsJSON: String
    var createdAt: Date
    init(title: String, english: String, chinese: String, targetWords: [String]) {
        id = UUID(); self.title = title; self.english = english; self.chinese = chinese
        targetWordsJSON = (try? String(data: JSONEncoder().encode(targetWords), encoding: .utf8)) ?? "[]"
        createdAt = .now
    }
    var targetWords: [String] { (try? JSONDecoder().decode([String].self, from: Data(targetWordsJSON.utf8))) ?? [] }
}
