import SwiftData
import SwiftUI

@main
struct WordHintApp: App {
    let container: ModelContainer
    @StateObject private var auth = AuthState()

    init() {
        do {
            container = try ModelContainer(for: Word.self, StudySession.self, GeneratedArticle.self)
        } catch {
            fatalError("SwiftData 初始化失败: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if auth.isChecking { ProgressView("正在检查账号…") }
                else if auth.isAuthenticated { RootView() }
                else { AuthView() }
            }
            .environmentObject(auth)
            .preferredColorScheme(.light)
        }
            .modelContainer(container)
    }
}
