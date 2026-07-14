import SwiftData
import SwiftUI

struct ArticleGeneratorView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \Word.nextReviewAt) private var words: [Word]
    @State private var theme = "日常生活"
    @State private var style = "故事"
    @State private var difficulty = "中等"
    @State private var article: ArticleResponse?
    @State private var targets: [Word] = []
    @State private var loading = false
    @State private var showChinese = true
    @State private var error: String?
    @StateObject private var audio = AudioService()

    var body: some View {
        ScrollView { VStack(alignment: .leading, spacing: 18) {
            if let article { articleContent(article) } else {
                VStack(alignment: .leading, spacing: 8) { Text("让生词重新进入语境").font(.system(size: 30, weight: .bold, design: .rounded)); Text("从新词、待复习和薄弱词中智能选词，生成一篇自然连贯的文章。").font(.subheadline).foregroundStyle(.secondary) }.padding(.top, 8)
                VStack(alignment: .leading, spacing: 17) {
                    Label("生成设置", systemImage: "slider.horizontal.3").font(.headline)
                    HStack { Text("主题"); Spacer(); Picker("主题", selection: $theme) { ForEach(["日常生活","旅行","商业","科技","校园","职场","心理学","电影","体育"], id: \.self, content: Text.init) }.labelsHidden() }
                    Divider()
                    VStack(alignment: .leading, spacing: 9) { Text("体裁").font(.subheadline).foregroundStyle(.secondary); Picker("体裁", selection: $style) { ForEach(["故事","对话","新闻","随笔"], id: \.self, content: Text.init) }.pickerStyle(.segmented) }
                    VStack(alignment: .leading, spacing: 9) { Text("难度").font(.subheadline).foregroundStyle(.secondary); Picker("难度", selection: $difficulty) { ForEach(["简单","中等","困难"], id: \.self, content: Text.init) }.pickerStyle(.segmented) }
                }.surface()
                HStack { Label("将使用", systemImage: "text.badge.checkmark"); Spacer(); Text("最多 10 个目标词").foregroundStyle(.secondary) }.font(.subheadline).padding(.horizontal, 2)
                Button { Task { await generate() } } label: { loading ? AnyView(ProgressView().tint(.white)) : AnyView(Label("生成今日短文", systemImage: "sparkles")) }.buttonStyle(PrimaryButtonStyle()).disabled(words.isEmpty || loading)
            }
        }.padding(.horizontal, 18).padding(.bottom, 28) }.pageBackground().navigationTitle("AI 阅读").navigationBarTitleDisplayMode(.inline)
        .alert("生成失败", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) { Button("好") {} } message: { Text(error ?? "") }
    }

    private func articleContent(_ value: ArticleResponse) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(value.title).font(.largeTitle.bold())
            HStack { Button { audio.isSpeaking ? audio.stop() : audio.speak(value.english) } label: { Label(audio.isSpeaking ? "停止" : "朗读", systemImage: audio.isSpeaking ? "stop.fill" : "speaker.wave.2.fill") }; Spacer(); Toggle("中文", isOn: $showChinese).labelsHidden() }
            ForEach(Array(value.english.components(separatedBy: "\n\n").enumerated()), id: \.offset) { index, paragraph in
                VStack(alignment: .leading, spacing: 10) {
                    highlighted(paragraph).font(.body.leading(.loose)).textSelection(.enabled)
                    if showChinese { let translations = value.chinese.components(separatedBy: "\n\n"); if translations.indices.contains(index) { Text(translations[index]).foregroundStyle(.secondary).padding(.top, 3) } }
                    Button { audio.speak(paragraph) } label: { Image(systemName: "play.circle") }.buttonStyle(.plain).foregroundStyle(AppTheme.terracotta)
                }.padding(.vertical, 8)
            }
            Button { article = nil } label: { Label("调整并重新生成", systemImage: "arrow.clockwise") }.buttonStyle(.bordered).tint(AppTheme.terracotta)
            NavigationLink { PracticeView(words: targets) } label: { Label("完成阅读，开始练习", systemImage: "checkmark.circle") }.buttonStyle(PrimaryButtonStyle())
        }
    }

    private func highlighted(_ text: String) -> Text {
        let targetSet = Set(targets.map(\.normalizedWord)); var output = Text("")
        for token in text.split(omittingEmptySubsequences: false, whereSeparator: { $0.isWhitespace }) {
            let raw = String(token); let clean = Word.normalize(raw.trimmingCharacters(in: .punctuationCharacters))
            output = output + (targetSet.contains(clean) ? Text(raw).foregroundColor(AppTheme.terracotta).bold() : Text(raw)) + Text(" ")
        }
        return output
    }

    @MainActor private func generate() async {
        loading = true; defer { loading = false }
        targets = Array(words.filter { $0.status != .ignored && $0.status != .mastered }.sorted { rank($0) < rank($1) }.prefix(10))
        do { article = try await LLMService.shared.generateArticle(words: targets.map { WordSnapshot(word: $0.word, meaning: $0.meaning, sentence: $0.sentence) }, theme: theme, style: style, difficulty: difficulty); if let article { context.insert(GeneratedArticle(title: article.title, english: article.english, chinese: article.chinese, targetWords: targets.map(\.word))); try? context.save() } } catch { self.error = error.localizedDescription }
    }
    private func rank(_ word: Word) -> Int { switch word.status { case .weak: 0; case .due: 1; case .new: 2; default: 3 } }
}
