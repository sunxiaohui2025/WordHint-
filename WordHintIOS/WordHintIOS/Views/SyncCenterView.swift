import SwiftData
import SwiftUI
import UniformTypeIdentifiers

struct SyncCenterView: View {
    @Environment(\.modelContext) private var context
    @EnvironmentObject private var auth: AuthState
    @Query private var localWords: [Word]
    @StateObject private var server = LANSyncServer()
    @State private var importing = false
    @State private var report: ImportReport?
    @State private var error: String?
    @State private var cloudSyncing = false

    var body: some View {
        ScrollView { VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 16) {
                Image(systemName: "laptopcomputer.and.iphone").font(.system(size: 32, weight: .medium)).foregroundStyle(.white).frame(width: 66, height: 66).background(AppTheme.terracotta, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                VStack(alignment: .leading, spacing: 5) { Text("连接 Chrome").font(.title2.bold()); Text("把浏览器里的真实阅读词汇带到手机").font(.subheadline).foregroundStyle(.secondary) }
            }.padding(.top, 8)
            if let report = report ?? server.lastReport { reportView(report) }
            VStack(alignment: .leading, spacing: 14) {
                HStack { Label("WordHint 云同步", systemImage: "cloud.fill").font(.headline); Spacer(); Circle().fill(AppTheme.sage).frame(width: 9, height: 9) }
                Text("已登录：\(auth.user?.name ?? "")。数据按账号隔离，手机与电脑不需要在同一网络，也不需要同时在线。")
                    .font(.subheadline).foregroundStyle(.secondary)
                HStack(spacing: 0) {
                    localMetric("学习词", localWords.filter { $0.status != .ignored }.count)
                    Divider().frame(height: 32)
                    localMetric("熟词", localWords.filter { $0.status == .ignored }.count)
                    Divider().frame(height: 32)
                    localMetric("本机总数", localWords.count)
                }
                .padding(.vertical, 8)
                .background(AppTheme.blush.opacity(0.65), in: RoundedRectangle(cornerRadius: 10))
                Button { Task { await syncCloud() } } label: {
                    HStack { if cloudSyncing { ProgressView().tint(.white) }; Text(cloudSyncing ? "正在同步…" : "立即双向同步") }
                }.buttonStyle(PrimaryButtonStyle()).disabled(cloudSyncing)
                if let last = UserDefaults.standard.object(forKey: "cloudLastSync") as? Date {
                    Text("上次同步：\(last.formatted(date: .abbreviated, time: .shortened))").font(.caption).foregroundStyle(.secondary)
                }
                Button("退出账号", role: .destructive) { auth.logout() }.font(.subheadline)
            }.surface()
            VStack(alignment: .leading, spacing: 14) {
                HStack { Label(server.isRunning ? "正在等待数据" : "无线接收", systemImage: server.isRunning ? "dot.radiowaves.left.and.right" : "wifi").font(.headline); Spacer(); Circle().fill(server.isRunning ? AppTheme.sage : .secondary.opacity(0.3)).frame(width: 9, height: 9) }
                Text("确保手机与电脑连接同一个 Wi-Fi，然后将下方地址填入 Chrome 插件。例：192.168.1.10").font(.subheadline).foregroundStyle(.secondary)
                if server.isRunning { Text(server.address).font(.system(.footnote, design: .monospaced).weight(.medium)).textSelection(.enabled).padding(12).frame(maxWidth: .infinity, alignment: .leading).background(AppTheme.blush, in: RoundedRectangle(cornerRadius: 10)) }
                Button(server.isRunning ? "停止接收" : "开启无线接收") { server.isRunning ? server.stop() : server.start(context: context) }.buttonStyle(PrimaryButtonStyle())
            }.surface()
            VStack(alignment: .leading, spacing: 12) {
                Label("JSON 文件导入", systemImage: "doc.badge.plus").font(.headline)
                Text("支持插件导出的完整备份，也支持仅包含 wordbook 数组的 JSON。重复单词会合并，不会重置学习记录。").font(.subheadline).foregroundStyle(.secondary)
                Button { importing = true } label: { Label("选择备份文件", systemImage: "folder").frame(maxWidth: .infinity).frame(height: 42) }.buttonStyle(.bordered).tint(AppTheme.terracotta)
            }.surface()
            
        }.padding(.horizontal, 18).padding(.bottom, 28) }.pageBackground().navigationTitle("同步")
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
            do { let url = try result.get(); guard url.startAccessingSecurityScopedResource() else { throw CocoaError(.fileReadNoPermission) }; defer { url.stopAccessingSecurityScopedResource() }; report = try ImportService.importData(Data(contentsOf: url), into: context) } catch { self.error = error.localizedDescription }
        }
        .alert("同步或导入失败", isPresented: Binding(get: { error != nil || server.errorMessage != nil }, set: { if !$0 { error = nil; server.errorMessage = nil } })) { Button("好") {} } message: { Text(error ?? server.errorMessage ?? "未知错误") }
    }
    private func syncCloud() async {
        cloudSyncing = true
        do { report = try await CloudSyncService.sync(context: context) }
        catch { self.error = error.localizedDescription }
        cloudSyncing = false
    }
    private func localMetric(_ title: String, _ value: Int) -> some View {
        VStack(spacing: 3) {
            Text("\(value)").font(.headline.monospacedDigit()).foregroundStyle(AppTheme.ink)
            Text(title).font(.caption2).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity)
    }
    private func reportView(_ value: ImportReport) -> some View { HStack { Label("新增 \(value.inserted)", systemImage: "plus.circle.fill"); Spacer(); Text("更新 \(value.updated)"); Spacer(); Text("跳过 \(value.skipped)") }.font(.subheadline).foregroundStyle(AppTheme.terracottaDark).surface() }
}
