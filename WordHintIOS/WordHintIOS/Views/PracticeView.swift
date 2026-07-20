import SwiftData
import SwiftUI

private enum PracticeKind: Int { case meaning, listening, context
    var title: String { switch self { case .meaning: "看词辨义"; case .listening: "听音辨词"; case .context: "语境选词" } }
}

private struct PracticeQuestion: Identifiable {
    let id = UUID()
    let kind: PracticeKind
    let word: Word
    let options: [String]
    let correctAnswer: String
}

struct PracticeView: View {
    @Environment(\.modelContext) private var context
    let words: [Word]
    @State private var questions: [PracticeQuestion] = []
    @State private var index = 0
    @State private var selected = ""
    @State private var feedback: Bool?
    @State private var pendingStatus: LearningStatus?
    @State private var correctCount = 0
    @StateObject private var audio = AudioService()
    @Environment(\.dismiss) private var dismiss

    private var current: PracticeQuestion? { questions.indices.contains(index) ? questions[index] : nil }

    var body: some View {
        ZStack {
            ScrollView { VStack(spacing: 20) {
                if let question = current {
                    header(question)
                    prompt(question)
                    answerArea(question)
                    if let feedback {
                        feedbackView(correct: feedback, question: question)
                        quickStatus(question.word)
                    }
                    // 占位空间，避免内容被悬浮按钮遮挡
                    Spacer().frame(height: 80)
                } else if questions.isEmpty {
                    ContentUnavailableView("暂无可练习单词", systemImage: "text.book.closed", description: Text("先从 Chrome 同步学习名单"))
                    Button("返回") { dismiss() }.buttonStyle(PrimaryButtonStyle())
                } else {
                    ContentUnavailableView("今日练习完成", systemImage: "checkmark.seal.fill", description: Text("答对 \(correctCount) / \(questions.count) 题"))
                    Button("完成") { dismiss() }.buttonStyle(PrimaryButtonStyle())
                }
            }}
            .padding(.horizontal, 18).padding(.vertical, 12).pageBackground()

            // 悬浮底部的"下一题"按钮
            if current != nil {
                VStack { Spacer()
                    Button(feedback == nil ? "提交答案" : "下一题") {
                        feedback == nil ? submit(current!) : advance()
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(feedback == nil && selected.isEmpty)
                    .padding(.horizontal, 18)
                    .padding(.bottom, 12)
                }
            }
        }
        .navigationTitle("混合练习").navigationBarTitleDisplayMode(.inline)
        .onAppear { if questions.isEmpty { questions = buildQuestions() } }
    }

    private func header(_ question: PracticeQuestion) -> some View {
        VStack(spacing: 10) {
            ProgressView(value: Double(index), total: Double(max(1, questions.count))).tint(AppTheme.terracotta)
            HStack {
                Label(question.kind.title, systemImage: icon(for: question.kind)).font(.subheadline.weight(.semibold)).foregroundStyle(AppTheme.terracottaDark)
                Spacer()
                Text("\(index + 1) / \(questions.count)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder private func prompt(_ question: PracticeQuestion) -> some View {
        switch question.kind {
        case .meaning:
            VStack(spacing: 10) {
                Text(question.word.word).font(.system(size: 42, weight: .bold, design: .rounded))
                Button { audio.speak(question.word.word) } label: { Label("美式发音", systemImage: "speaker.wave.2") }.font(.subheadline)
            }.frame(maxWidth: .infinity).padding(.vertical, 18)
        case .listening:
            VStack(spacing: 14) {
                Button { audio.speak(question.word.word) } label: {
                    Image(systemName: "speaker.wave.3.fill").font(.system(size: 46)).foregroundStyle(AppTheme.terracotta).frame(width: 116, height: 116).background(AppTheme.blush, in: Circle())
                }.buttonStyle(.plain)
                Text("点击喇叭再听一次").font(.caption).foregroundStyle(.secondary)
            }.onAppear { audio.speak(question.word.word) }
        case .context:
            VStack(alignment: .leading, spacing: 10) {
                Text("选择最适合空格的单词").font(.subheadline).foregroundStyle(.secondary)
                Text(contextPrompt(for: question.word)).font(.title3.weight(.medium)).lineSpacing(6).frame(maxWidth: .infinity, alignment: .leading)
            }.padding(18).background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(AppTheme.line))
        }
    }

    @ViewBuilder private func answerArea(_ question: PracticeQuestion) -> some View {
        VStack(spacing: 10) {
            ForEach(question.options, id: \.self) { option in
                Button { guard feedback == nil else { return }; selected = option } label: {
                    HStack { Text(option).multilineTextAlignment(.leading); Spacer(); optionIcon(option, question: question) }
                        .padding(.horizontal, 15).frame(maxWidth: .infinity, minHeight: 52).background(optionBackground(option, question: question), in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(optionBorder(option, question: question), lineWidth: 1.5))
                }.buttonStyle(.plain)
            }
        }
    }

    private func feedbackView(correct: Bool, question: PracticeQuestion) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 9) {
                Image(systemName: correct ? "checkmark.circle.fill" : "xmark.circle.fill").font(.title2)
                Text(correct ? "回答正确" : "再记一下").font(.headline)
                Spacer()
            }.foregroundStyle(correct ? AppTheme.sage : .red)
            Divider()
            HStack(alignment: .firstTextBaseline) { Text(question.word.word).font(.title3.bold()); if let part = question.word.partOfSpeech, !part.isEmpty { Text(part).font(.caption.weight(.semibold)).foregroundStyle(AppTheme.terracotta) }; Spacer(); Button { audio.speak(question.word.word) } label: { Image(systemName: "speaker.wave.2.fill") } }
            Text("正确答案：\(question.correctAnswer)").font(.subheadline.weight(.semibold))
            if !question.word.meaning.isEmpty { Text(question.word.meaning).font(.subheadline).foregroundStyle(.secondary) }
            if let english = question.word.englishDefinition, !english.isEmpty { Text(english).font(.caption).foregroundStyle(.secondary) }
            if let practice = practiceSentence(for: question.word) {
                VStack(alignment: .leading, spacing: 4) { Text("本题例句").font(.caption.weight(.semibold)).foregroundStyle(AppTheme.terracottaDark); Text(practice).font(.subheadline).lineSpacing(3) }
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading).background(AppTheme.blush.opacity(0.6), in: RoundedRectangle(cornerRadius: 9))
            }
            if !question.word.sentence.isEmpty, question.word.sentence != practiceSentence(for: question.word) {
                VStack(alignment: .leading, spacing: 4) { Text("网页原始语境").font(.caption.weight(.semibold)).foregroundStyle(.secondary); Text(question.word.sentence).font(.caption).lineSpacing(3).foregroundStyle(.secondary) }
                    .padding(.horizontal, 10)
            }
        }.padding(14).background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(correct ? AppTheme.sage.opacity(0.5) : Color.red.opacity(0.35)))
    }

    private func buildQuestions() -> [PracticeQuestion] {
        let source = Array(words.prefix(20))
        return source.enumerated().map { position, word in
            let requested = PracticeKind(rawValue: position % 3) ?? .meaning
            let kind: PracticeKind = requested == .context && practiceSentence(for: word) == nil ? .meaning : requested
            switch kind {
            case .meaning:
                let wrong = source.filter { $0 !== word }.map(\.meaning).filter { !$0.isEmpty && $0 != word.meaning }.shuffled().prefix(3)
                return PracticeQuestion(kind: kind, word: word, options: ([word.meaning] + wrong).shuffled(), correctAnswer: word.meaning)
            case .listening:
                let wrong = source.filter { $0 !== word }.map(\.word).shuffled().prefix(3)
                return PracticeQuestion(kind: kind, word: word, options: ([word.word] + wrong).shuffled(), correctAnswer: word.word)
            case .context:
                let wrong = source.filter { $0 !== word }.map(\.word).shuffled().prefix(3)
                return PracticeQuestion(kind: kind, word: word, options: ([word.word] + wrong).shuffled(), correctAnswer: word.word)
            }
        }
    }

    private func submit(_ question: PracticeQuestion) {
        let answer = selected
        let correct = Word.normalize(answer) == Word.normalize(question.correctAnswer)
        feedback = correct
        if correct { correctCount += 1 }
        SM2Scheduler.review(question.word, quality: correct ? 5 : 2)
        try? context.save()
    }

    private func advance() {
        if let pendingStatus, let question = current {
            question.word.status = pendingStatus
        }
        selected = ""; feedback = nil; pendingStatus = nil; index += 1
        if index == questions.count {
            context.insert(StudySession(reviewed: questions.count, correct: correctCount, newWords: questions.filter { $0.word.repetitions <= 1 }.count))
        }
        try? context.save()
    }

    private func contextPrompt(for word: Word) -> String {
        guard let sentence = practiceSentence(for: word) else { return "" }
        return sentence.replacingOccurrences(of: "\\b\(NSRegularExpression.escapedPattern(for: word.word))\\b", with: "______", options: [.regularExpression, .caseInsensitive])
    }

    private func practiceSentence(for word: Word) -> String? {
        for candidate in [word.generatedSentence, word.sentence].compactMap({ $0?.trimmingCharacters(in: .whitespacesAndNewlines) }) {
            let pattern = "\\b\(NSRegularExpression.escapedPattern(for: word.word))\\b"
            guard candidate.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil else { continue }
            let remainder = candidate.replacingOccurrences(of: pattern, with: "", options: [.regularExpression, .caseInsensitive])
            let words = remainder.split(whereSeparator: { !$0.isLetter })
            if words.count >= 5 { return candidate }
        }
        return nil
    }
    private func quickStatus(_ word: Word) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("调整这个词的学习状态（可选）").font(.caption).foregroundStyle(.secondary)
            HStack(spacing: 7) {
                ForEach([LearningStatus.due, .weak, .mastered, .ignored]) { status in
                    Button { pendingStatus = pendingStatus == status ? nil : status } label: {
                        let isSelected = pendingStatus == status
                        Text(status.title).font(.caption.weight(.semibold)).padding(.horizontal, 10).frame(height: 34).foregroundStyle(isSelected ? .white : AppTheme.ink).background(isSelected ? AppTheme.terracotta : AppTheme.surface, in: Capsule()).overlay(Capsule().stroke(isSelected ? .clear : AppTheme.line))
                    }.buttonStyle(.plain)
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func icon(for kind: PracticeKind) -> String { switch kind { case .meaning: "text.book.closed"; case .listening: "ear"; case .context: "text.badge.checkmark" } }
    private func optionBackground(_ option: String, question: PracticeQuestion) -> Color { if feedback != nil && option == question.correctAnswer { return AppTheme.sage.opacity(0.12) }; if feedback == false && option == selected { return Color.red.opacity(0.1) }; return selected == option ? AppTheme.blush : AppTheme.surface }
    private func optionBorder(_ option: String, question: PracticeQuestion) -> Color { if feedback != nil && option == question.correctAnswer { return AppTheme.sage }; if feedback == false && option == selected { return .red }; return selected == option ? AppTheme.terracotta : AppTheme.line }
    @ViewBuilder private func optionIcon(_ option: String, question: PracticeQuestion) -> some View { if feedback != nil && option == question.correctAnswer { Image(systemName: "checkmark.circle.fill").foregroundStyle(AppTheme.sage) } else if feedback == false && option == selected { Image(systemName: "xmark.circle.fill").foregroundStyle(.red) } }
}

struct ShadowingView: View {
    let sentence: String
    @StateObject private var audio = AudioService()
    @State private var recording = false
    var body: some View {
        VStack(spacing: 20) { Text(sentence).font(.title3).multilineTextAlignment(.center); Button { audio.speak(sentence, rate: 0.42) } label: { Label("慢速播放", systemImage: "speaker.wave.2") }; Text(audio.transcript.isEmpty ? "识别结果会显示在这里" : audio.transcript).padding().frame(maxWidth: .infinity).background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12)); Button { Task { if recording { audio.stopRecognition(); recording = false } else if await audio.requestPermissions() { try? audio.startRecognition(); recording = true } } } label: { Label(recording ? "停止录音" : "开始跟读", systemImage: recording ? "stop.circle.fill" : "mic.circle.fill") }.buttonStyle(PrimaryButtonStyle()) }.padding().navigationTitle("跟读模式")
    }
}
