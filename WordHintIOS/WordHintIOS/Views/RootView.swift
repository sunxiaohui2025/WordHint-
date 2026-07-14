import SwiftData
import SwiftUI

struct RootView: View {
    @Environment(\.modelContext) private var context
    @State private var initialized = false

    var body: some View {
        TabView {
            NavigationStack { DashboardView() }.tabItem { Label("今日", systemImage: "house.fill") }
            NavigationStack { LexiconView() }.tabItem { Label("词库", systemImage: "text.book.closed.fill") }
            NavigationStack { ArticleGeneratorView() }.tabItem { Label("短文", systemImage: "sparkles") }
            NavigationStack { SyncCenterView() }.tabItem { Label("同步", systemImage: "arrow.triangle.2.circlepath") }
        }
        .tint(AppTheme.terracotta)
        .preferredColorScheme(.light)
        .foregroundStyle(AppTheme.ink)
        .toolbarBackground(.visible, for: .tabBar)
        .toolbarBackground(AppTheme.surface, for: .tabBar)
        .task {
            guard !initialized else { return }; initialized = true
            try? ImportService.initializeBundledDictionary(into: context)
        }
    }
}
