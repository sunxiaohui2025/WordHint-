# WordHint iOS

原生 SwiftUI + SwiftData iOS 17 应用，与 `../wordhint` Chrome 插件配套。

## 运行

1. 安装完整版 Xcode 16（仅 Command Line Tools 不能运行 iOS App）。
2. 打开 `WordHintIOS.xcodeproj`，在 Signing & Capabilities 选择自己的 Team。
3. 选择 iOS 17+ 模拟器或真机运行。局域网同步必须使用真机，并与电脑处于同一 Wi-Fi。
4. App 的“同步”页开启接收，把显示的完整地址填进 Chrome 插件“同步到 iPhone”。

JSON 文件导入支持插件“备份数据”产生的文件。内置 `Resources/WordLibraries` 来自插件数据目录，作为查询和分级参考资源随 App 打包。
插件 `wordbook` 会导入为可学习单词；`whitelist` 会保留为“已忽略”状态，两个列表继续保持互斥。

## 安全配置

当前 API 地址和 key 按需求位于 `Services/LLMService.swift`。正式发布前应改为 Keychain/设置页注入，并为服务启用 HTTPS。当前 HTTP 服务和大模型 HTTP 请求需要 ATS 例外。
