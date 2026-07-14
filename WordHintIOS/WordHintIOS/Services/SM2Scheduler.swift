import Foundation

enum SM2Scheduler {
    /// quality: 0...5. Values below 3 reset the repetition sequence.
    static func review(_ word: Word, quality rawQuality: Int, now: Date = .now) {
        let quality = min(5, max(0, rawQuality))
        if quality < 3 {
            word.repetitions = 0
            word.intervalDays = 1
            word.lapseCount += 1
        } else {
            word.intervalDays = switch word.repetitions { case 0: 1; case 1: 6; default: max(1, Int((Double(word.intervalDays) * word.easeFactor).rounded())) }
            word.repetitions += 1
        }
        let q = Double(quality)
        word.easeFactor = max(1.3, word.easeFactor + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
        word.lastReviewedAt = now
        word.nextReviewAt = Calendar.current.date(byAdding: .day, value: word.intervalDays, to: now) ?? now
        word.statusRaw = quality < 3 ? LearningStatus.weak.rawValue : LearningStatus.learning.rawValue
        word.updatedAt = now
    }
}
