import SwiftData
import SwiftUI

struct LexiconView: View {
    @Query(sort: \Word.addedAt, order: .reverse) private var words: [Word]
    @State private var search = ""
    @State private var filter: LearningStatus?
    private var filtered: [Word] { words.filter { (search.isEmpty || $0.word.localizedCaseInsensitiveContains(search) || $0.meaning.contains(search)) && (filter == nil || $0.status == filter) } }

    var body: some View {
        List {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) { chip("全部", selected: filter == nil) { filter = nil }; ForEach(LearningStatus.allCases) { status in chip(status.title, selected: filter == status) { filter = status } } }.padding(.horizontal, 18)
            }.listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0)).listRowBackground(Color.clear).listRowSeparator(.hidden)
            ForEach(filtered) { word in
                NavigationLink { WordDetailView(word: word) } label: {
                    HStack(spacing: 13) {
                        Text(String(word.word.prefix(1)).uppercased()).font(.headline).foregroundStyle(AppTheme.terracottaDark).frame(width: 40, height: 40).background(AppTheme.blush, in: RoundedRectangle(cornerRadius: 11))
                        VStack(alignment: .leading, spacing: 4) {
                            HStack { Text(word.word).font(.headline); Spacer(); Text(word.status.title).font(.caption2.weight(.semibold)).foregroundStyle(AppTheme.terracotta).padding(.horizontal, 8).padding(.vertical, 4).background(AppTheme.blush, in: Capsule()) }
                            Text(word.meaning.isEmpty ? "暂无释义" : word.meaning).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                            if !word.sentence.isEmpty { Text(word.sentence).font(.caption).foregroundStyle(.tertiary).lineLimit(1) }
                        }
                    }.padding(.vertical, 5)
                }.listRowBackground(AppTheme.surface).listRowSeparatorTint(AppTheme.line)
            }
        }.scrollContentBackground(.hidden).listStyle(.insetGrouped).pageBackground().searchable(text: $search, prompt: "搜索单词或释义").navigationTitle("词库").overlay { if filtered.isEmpty { ContentUnavailableView("还没有匹配的单词", systemImage: "text.book.closed") } }
    }
    private func chip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View { Button(title, action: action).font(.subheadline.weight(.medium)).padding(.horizontal, 14).frame(height: 34).foregroundStyle(selected ? .white : AppTheme.ink).background(selected ? AppTheme.terracotta : AppTheme.surface, in: Capsule()).overlay(Capsule().stroke(selected ? .clear : AppTheme.line)) }
}

struct WordDetailView: View {
    @Environment(\.modelContext) private var context
    @Bindable var word: Word
    @StateObject private var audio = AudioService()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Form {
            Section { VStack(alignment: .leading, spacing: 8) { HStack(alignment: .firstTextBaseline) { Text(word.word).font(.largeTitle.bold()); Spacer(); Button { audio.speak(word.word) } label: { Image(systemName: "speaker.wave.2.fill") } }; Text(word.phonetic ?? "美式发音").foregroundStyle(.secondary); Text(word.partOfSpeech ?? "").font(.caption).foregroundStyle(AppTheme.terracotta); Text(word.meaning).font(.title3) } }
            Section("真实阅读语境") { Text(word.sentence.isEmpty ? "暂无来源语境" : word.sentence).textSelection(.enabled) }
            Section("学习状态") {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    ForEach(LearningStatus.allCases) { status in
                        Button { word.status = status; try? context.save() } label: {
                            HStack { Image(systemName: word.status == status ? "largecircle.fill.circle" : "circle"); Text(status.title); Spacer() }
                                .font(.subheadline.weight(.medium)).foregroundStyle(word.status == status ? AppTheme.terracottaDark : AppTheme.ink)
                                .padding(.horizontal, 11).frame(height: 42).background(word.status == status ? AppTheme.blush : AppTheme.surface, in: RoundedRectangle(cornerRadius: 10))
                        }.buttonStyle(.plain)
                    }
                }
                Button("删除单词", role: .destructive) { context.delete(word); try? context.save(); dismiss() }
            }
            Section("记忆进度") { LabeledContent("状态", value: word.status.title); LabeledContent("记忆难度", value: String(format: "%.2f", word.easeFactor)); LabeledContent("间隔", value: "\(word.intervalDays) 天"); LabeledContent("错误次数", value: "\(word.lapseCount)"); LabeledContent("下次复习", value: word.nextReviewAt.formatted(date: .abbreviated, time: .omitted)) }
            Section("我的笔记") { TextEditor(text: $word.note).frame(minHeight: 100) }
        }.scrollContentBackground(.hidden).pageBackground().navigationTitle("单词详情").navigationBarTitleDisplayMode(.inline)
    }
}
