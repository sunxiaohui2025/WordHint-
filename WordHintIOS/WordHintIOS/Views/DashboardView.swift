import Charts
import SwiftData
import SwiftUI

struct DashboardView: View {
    @Query(sort: \Word.nextReviewAt) private var words: [Word]
    @Query(sort: \StudySession.date, order: .reverse) private var sessions: [StudySession]
    @State private var showPractice = false
    private var due: [Word] { words.filter { $0.status == .due } }
    private var weak: [Word] { words.filter { $0.status == .weak } }
    private var newWords: [Word] { words.filter { $0.status == .new } }
    private var todayWords: [Word] { Array((weak + due + newWords).prefix(20)) }
    private var rhythm: [DailyRhythm] {
        let calendar = Calendar.current
        return (0..<7).reversed().compactMap { offset in
            guard let date = calendar.date(byAdding: .day, value: -offset, to: .now) else { return nil }
            let reviewed = sessions.filter { calendar.isDate($0.date, inSameDayAs: date) }.reduce(0) { $0 + $1.reviewed }
            return DailyRhythm(date: date, reviewed: reviewed)
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 9) {
                    Text(Date.now.formatted(.dateTime.month().day().weekday(.wide)))
                        .font(.subheadline.weight(.semibold)).foregroundStyle(AppTheme.terracottaDark)
                    Text("今天，读懂更多").font(.system(size: 32, weight: .bold, design: .rounded)).foregroundStyle(AppTheme.ink)
                    Text(words.isEmpty ? "先从 Chrome 同步你的真实阅读词汇" : "你的今日学习计划已经准备好了")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                HStack(spacing: 12) {
                    metric("待复习", due.count + weak.count, "clock.arrow.circlepath", AppTheme.terracotta)
                    metric("新词", newWords.count, "plus", AppTheme.sage)
                    metric("已掌握", words.filter { $0.status == .mastered }.count, "checkmark", .primary)
                }
                VStack(alignment: .leading, spacing: 10) {
                    Text("今日计划").font(.headline)
                    planRow("新词", count: min(10, newWords.count), icon: "sparkle")
                    planRow("间隔复习", count: due.count, icon: "brain.head.profile")
                    planRow("薄弱强化", count: weak.count, icon: "bolt.heart")
                }.surface()
                VStack(alignment: .leading, spacing: 12) {
                    HStack { Text("学习节奏").font(.headline); Spacer(); Text("最近 7 天").font(.caption).foregroundStyle(.secondary) }
                    Chart(rhythm) { item in
                        BarMark(x: .value("日期", item.date, unit: .day), y: .value("复习", item.reviewed), width: .fixed(16))
                            .foregroundStyle(AppTheme.terracotta.gradient).cornerRadius(5)
                    }
                    .chartXAxis { AxisMarks(values: .stride(by: .day)) { _ in AxisValueLabel(format: .dateTime.weekday(.narrow)); AxisTick(); AxisGridLine().foregroundStyle(AppTheme.line.opacity(0.5)) } }
                    .chartYAxis { AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) }
                    .frame(height: 150)
                    if sessions.isEmpty { Text("完成练习后，这里会按天累计练习量").font(.caption).foregroundStyle(.secondary) }
                }.surface()
                Button { showPractice = true } label: { Label("开始今日学习", systemImage: "play.fill") }.buttonStyle(PrimaryButtonStyle()).disabled(todayWords.isEmpty)
                
            }.padding(.horizontal, 18).padding(.top, 14).padding(.bottom, 28)
        }
        .pageBackground().navigationTitle("WordHint").navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showPractice) { NavigationStack { PracticeView(words: todayWords) } }
    }

    private func metric(_ title: String, _ value: Int, _ icon: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Image(systemName: icon).font(.caption.bold()).frame(width: 27, height: 27).foregroundStyle(color).background(color.opacity(0.12), in: Circle())
            Text("\(value)").font(.system(size: 25, weight: .bold, design: .rounded)); Text(title).font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(13).background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 14).stroke(AppTheme.line))
    }
    private func planRow(_ title: String, count: Int, icon: String) -> some View { HStack(spacing: 12) { Image(systemName: icon).frame(width: 30, height: 30).foregroundStyle(AppTheme.terracotta).background(AppTheme.blush, in: RoundedRectangle(cornerRadius: 8)); Text(title); Spacer(); Text("\(count)").font(.headline.monospacedDigit()); Text("个").font(.caption).foregroundStyle(.secondary) }.padding(.vertical, 4) }
}

private struct DailyRhythm: Identifiable { let date: Date; let reviewed: Int; var id: Date { date } }
