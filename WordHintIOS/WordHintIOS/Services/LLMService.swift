import Foundation

struct LLMConfig: Sendable {
    var enableThinking = false
    var temperature = 0.0
    var maxTokens = 5000
    var maxTokensSelection = 6000
}

struct ArticleResponse: Codable, Sendable { let title: String; let english: String; let chinese: String }

actor LLMService {
    static let shared = LLMService()
    private let config = LLMConfig()

    func generateArticle(words: [WordSnapshot], theme: String, style: String, difficulty: String) async throws -> ArticleResponse {
        let targets = words.map { "\($0.word)：\($0.meaning)；真实语境：\($0.sentence)" }.joined(separator: "\n")
        let system = """
        你是面向中国英语学习者的优秀英文作者。围绕目标词写一篇自然连贯、具有完整情节或论述逻辑的英文短文，严禁例句拼接。目标词必须原样出现。返回严格 JSON：{"title":"","english":"多个段落，用\\n\\n分隔","chinese":"逐段对应翻译，用\\n\\n分隔"}。不要 Markdown。
        """
        let user = "主题：\(theme)\n体裁：\(style)\n难度：\(difficulty)\n目标词：\n\(targets)"
        return try await complete(system: system, user: user, maxTokens: config.maxTokens, as: ArticleResponse.self)
    }

    func lookup(word: String, context: String) async throws -> ChromeWord {
        let system = "返回严格 JSON，字段为 word、meaning、partOfSpeech、phonetic、englishDefinition、sentence。根据语境给出简洁准确的词义，不要 Markdown。"
        return try await complete(system: system, user: "单词：\(word)\n语境：\(context)", maxTokens: config.maxTokensSelection, as: ChromeWord.self)
    }

    private func complete<T: Decodable>(system: String, user: String, maxTokens: Int, as: T.Type) async throws -> T {
        guard let url = URL(string: "\(CloudConfiguration.baseURL)/api/v1/llm/chat") else { throw URLError(.badURL) }
        var request = URLRequest(url: url); request.httpMethod = "POST"; request.timeoutInterval = 90
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        guard let token = KeychainStore.token() else { throw CloudError.message("请先登录") }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "messages": [["role": "system", "content": system], ["role": "user", "content": user]],
            "temperature": config.temperature,
            "max_tokens": maxTokens,
            "chat_template_kwargs": ["enable_thinking": config.enableThinking]
        ])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw CloudError.message("模型服务无响应")
        }
        guard 200..<300 ~= http.statusCode else {
            let detail = LLMService.extractServerMessage(from: data) ?? "AI 生成失败（\(http.statusCode)）"
            throw CloudError.message(detail)
        }
        let envelope: ChatEnvelope
        do {
            envelope = try JSONDecoder().decode(ChatEnvelope.self, from: data)
        } catch {
            let body = String(data: data, encoding: .utf8)?.prefix(300) ?? ""
            throw CloudError.message("模型返回格式不兼容：\(body)")
        }
        let raw = envelope.choices.first?.message.content ?? ""
        let cleaned = raw.replacingOccurrences(of: "```json", with: "").replacingOccurrences(of: "```", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            return try JSONDecoder().decode(T.self, from: Data(cleaned.utf8))
        } catch {
            throw CloudError.message("AI 返回内容无法解析，请检查模型输出是否为严格 JSON。")
        }
    }

    private static func extractServerMessage(from data: Data) -> String? {
        if let payload = try? JSONDecoder().decode(ServerErrorPayload.self, from: data) {
            return payload.detail
        }
        if let text = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
            return text
        }
        return nil
    }
}

struct WordSnapshot: Sendable { let word: String; let meaning: String; let sentence: String }
private struct ChatEnvelope: Decodable { struct Choice: Decodable { struct Message: Decodable { let content: String }; let message: Message }; let choices: [Choice] }
private struct ServerErrorPayload: Decodable { let detail: String }
