import SwiftUI

struct AuthView: View {
    @EnvironmentObject private var auth: AuthState
    @State private var isRegistering = false
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var serverURL = CloudConfiguration.baseURL
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("WordHint").font(.system(size: 38, weight: .bold))
                        Text("让浏览器里的每一次阅读，在手机上继续生长。")
                            .foregroundStyle(AppTheme.mutedInk)
                    }.padding(.top, 44)
                    VStack(spacing: 14) {
                        Picker("账号操作", selection: $isRegistering) { Text("登录").tag(false); Text("注册").tag(true) }.pickerStyle(.segmented)
                        if isRegistering { TextField("昵称", text: $name).textContentType(.name) }
                        TextField("邮箱", text: $email).textInputAutocapitalization(.never).keyboardType(.emailAddress).textContentType(.emailAddress)
                        SecureField("密码（至少 8 位）", text: $password).textContentType(isRegistering ? .newPassword : .password)
                        DisclosureGroup("服务器设置") { TextField("https://你的服务器域名", text: $serverURL).textInputAutocapitalization(.never).keyboardType(.URL).padding(.top, 8) }
                            .font(.subheadline).foregroundStyle(AppTheme.mutedInk)
                        if let message = auth.message { Text(message).font(.subheadline).foregroundStyle(AppTheme.sage).frame(maxWidth: .infinity, alignment: .leading) }
                        if let error { Text(error).font(.subheadline).foregroundStyle(.red).frame(maxWidth: .infinity, alignment: .leading) }
                        Button { Task { await submit() } } label: { if busy { ProgressView().tint(.white) } else { Text(isRegistering ? "提交注册申请" : "登录") } }.buttonStyle(PrimaryButtonStyle()).disabled(busy)
                    }
                    .textFieldStyle(.roundedBorder).surface()
                    Text("词库会先保存在本机；联网时才与云端同步。管理员审批通过后方可登录。")
                        .font(.footnote).foregroundStyle(AppTheme.mutedInk)
                }.padding(.horizontal, 22)
            }.pageBackground()
        }
    }

    private func submit() async {
        busy = true; error = nil; CloudConfiguration.baseURL = serverURL
        do {
            if isRegistering { try await auth.register(name: name, email: email, password: password) }
            else { try await auth.login(email: email, password: password) }
        } catch { self.error = error.localizedDescription }
        busy = false
    }
}
