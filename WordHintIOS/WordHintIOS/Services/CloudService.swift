import Foundation
import Security
import SwiftData

enum CloudConfiguration {
    static var baseURL: String {
        get { UserDefaults.standard.string(forKey: "cloudBaseURL") ?? "https://wordhint.example.com" }
        set { UserDefaults.standard.set(newValue.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forKey: "cloudBaseURL") }
    }
}

enum KeychainStore {
    private static let service = "com.sun.wordhint.cloud"
    static func saveToken(_ value: String) {
        let data = Data(value.utf8)
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "token"]
        SecItemDelete(query as CFDictionary)
        var insert = query; insert[kSecValueData as String] = data
        SecItemAdd(insert as CFDictionary, nil)
    }
    static func token() -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "token", kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func clear() {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "token"] as CFDictionary)
    }
}

private struct AuthPayload: Encodable { let email: String; let password: String }
private struct RegisterPayload: Encodable { let name: String; let email: String; let password: String }
private struct LoginResponse: Decodable { let token: String; let user: CloudUser }
struct CloudUser: Codable { let email: String; let name: String; let role: String }
private struct MessageResponse: Decodable { let message: String }

@MainActor
final class AuthState: ObservableObject {
    @Published var user: CloudUser?
    @Published var isChecking = true
    @Published var message: String?
    var isAuthenticated: Bool { user != nil && KeychainStore.token() != nil }

    init() {
        if let data = UserDefaults.standard.data(forKey: "cloudUser"), let cached = try? JSONDecoder().decode(CloudUser.self, from: data), KeychainStore.token() != nil {
            user = cached
        }
        isChecking = false
        Task { await restore() }
    }

    func restore() async {
        guard KeychainStore.token() != nil else { return }
        // A network outage must not lock the user out of the local SwiftData library.
        if let refreshed: CloudUser = try? await CloudAPI.request("/api/v1/me", method: "GET") {
            user = refreshed
            cache(refreshed)
        }
    }

    func login(email: String, password: String) async throws {
        let response: LoginResponse = try await CloudAPI.request("/api/v1/auth/login", body: AuthPayload(email: email, password: password), authenticated: false)
        KeychainStore.saveToken(response.token); user = response.user; cache(response.user); message = nil
    }

    func register(name: String, email: String, password: String) async throws {
        let response: MessageResponse = try await CloudAPI.request("/api/v1/auth/register", body: RegisterPayload(name: name, email: email, password: password), authenticated: false)
        message = response.message
    }

    func logout() { KeychainStore.clear(); UserDefaults.standard.removeObject(forKey: "cloudUser"); user = nil }

    private func cache(_ user: CloudUser) {
        UserDefaults.standard.set(try? JSONEncoder().encode(user), forKey: "cloudUser")
    }
}

enum CloudAPI {
    static func request<Response: Decodable>(_ path: String, method: String = "POST", authenticated: Bool = true) async throws -> Response {
        try await request(path, method: method, bodyData: nil, authenticated: authenticated)
    }
    static func request<Body: Encodable, Response: Decodable>(_ path: String, method: String = "POST", body: Body, authenticated: Bool = true) async throws -> Response {
        try await request(path, method: method, bodyData: JSONEncoder.cloud.encode(body), authenticated: authenticated)
    }
    static func request<Response: Decodable>(_ path: String, method: String, bodyData: Data?, authenticated: Bool) async throws -> Response {
        guard let url = URL(string: CloudConfiguration.baseURL + path) else { throw CloudError.message("服务器地址不正确") }
        var request = URLRequest(url: url); request.httpMethod = method; request.timeoutInterval = 120
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = bodyData
        if authenticated {
            guard let token = KeychainStore.token() else { throw CloudError.message("请先登录") }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw CloudError.message("服务器无响应") }
        guard 200..<300 ~= http.statusCode else {
            let detail = (try? JSONDecoder().decode(ErrorResponse.self, from: data).detail) ?? "请求失败（\(http.statusCode)）"
            throw CloudError.message(detail)
        }
        do {
            return try JSONDecoder.cloud.decode(Response.self, from: data)
        } catch let error as DecodingError {
            throw CloudError.message("服务器数据格式不兼容：\(error.wordHintDescription)")
        }
    }
}

enum CloudError: LocalizedError { case message(String); var errorDescription: String? { if case .message(let value) = self { value } else { nil } } }
private struct ErrorResponse: Decodable { let detail: String }

private struct CloudSyncRequest: Encodable { let words: [CloudWord]; let whitelist: [String]; let since: Date? }
private struct CloudSyncResponse: Decodable { let words: [CloudWord]; let serverTime: Date }
private struct CloudWord: Codable {
    var word: String; var meaning: String?; var sentence: String?; var generatedSentence: String?; var time: Date?
    var lemma: String?; var partOfSpeech: String?; var phonetic: String?; var englishDefinition: String?; var sourceURL: String?; var note: String?
    var statusRaw: String?; var repetitions: Int?; var intervalDays: Int?; var easeFactor: Double?; var lapseCount: Int?
    var lastReviewedAt: Date?; var nextReviewAt: Date?; var updatedAt: Date?; var deleted: Bool?
}

@MainActor
enum CloudSyncService {
    static func sync(context: ModelContext) async throws -> ImportReport {
        let local = try context.fetch(FetchDescriptor<Word>())
        let words = local.map { word in CloudWord(word: word.word, meaning: word.meaning, sentence: word.sentence, generatedSentence: word.generatedSentence, time: word.addedAt, lemma: word.lemma, partOfSpeech: word.partOfSpeech, phonetic: word.phonetic, englishDefinition: word.englishDefinition, sourceURL: word.sourceURL, note: word.note, statusRaw: word.statusRaw, repetitions: word.repetitions, intervalDays: word.intervalDays, easeFactor: word.easeFactor, lapseCount: word.lapseCount, lastReviewedAt: word.lastReviewedAt, nextReviewAt: word.nextReviewAt, updatedAt: word.updatedAt ?? word.addedAt, deleted: false) }
        // Manual sync is deliberately a full reconciliation. The library is small, and a
        // server-side cursor shared by independent Chrome/iOS clients can otherwise skip
        // words uploaded by the other device before this device asks for its delta.
        let response: CloudSyncResponse = try await CloudAPI.request("/api/v1/sync", body: CloudSyncRequest(words: words, whitelist: [], since: nil))
        var byKey = Dictionary(uniqueKeysWithValues: local.map { ($0.normalizedWord, $0) })
        var report = ImportReport()
        for remote in response.words {
            let key = Word.normalize(remote.word)
            guard !key.isEmpty else { continue }
            if remote.deleted == true { if let item = byKey[key] { context.delete(item); byKey[key] = nil }; continue }
            let item: Word
            if let existing = byKey[key] { item = existing; report.updated += 1 }
            else { item = Word(word: remote.word, addedAt: remote.time ?? .now); context.insert(item); byKey[key] = item; report.inserted += 1 }
            item.meaning = remote.meaning ?? item.meaning; item.sentence = remote.sentence ?? item.sentence; item.generatedSentence = remote.generatedSentence ?? item.generatedSentence; item.lemma = remote.lemma; item.partOfSpeech = remote.partOfSpeech
            item.phonetic = remote.phonetic; item.englishDefinition = remote.englishDefinition; item.sourceURL = remote.sourceURL; item.note = remote.note ?? item.note
            item.statusRaw = remote.statusRaw ?? item.statusRaw; item.repetitions = remote.repetitions ?? item.repetitions; item.intervalDays = remote.intervalDays ?? item.intervalDays
            item.easeFactor = remote.easeFactor ?? item.easeFactor; item.lapseCount = remote.lapseCount ?? item.lapseCount; item.lastReviewedAt = remote.lastReviewedAt
            item.nextReviewAt = remote.nextReviewAt ?? item.nextReviewAt; item.updatedAt = remote.updatedAt ?? .now
        }
        try context.save(); UserDefaults.standard.set(response.serverTime, forKey: "cloudLastSync")
        return report
    }
}

extension JSONEncoder {
    static var cloud: JSONEncoder { let value = JSONEncoder(); value.dateEncodingStrategy = .iso8601; return value }
}
extension JSONDecoder {
    static var cloud: JSONDecoder {
        let value = JSONDecoder()
        value.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let standard = ISO8601DateFormatter()
            standard.formatOptions = [.withInternetDateTime]
            guard let date = fractional.date(from: text) ?? standard.date(from: text) else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "无法解析时间 \(text)")
            }
            return date
        }
        return value
    }
}

private extension DecodingError {
    var wordHintDescription: String {
        let context: Context
        switch self {
        case .typeMismatch(_, let value), .valueNotFound(_, let value), .keyNotFound(_, let value), .dataCorrupted(let value): context = value
        @unknown default: return localizedDescription
        }
        let path = context.codingPath.map(\.stringValue).joined(separator: ".")
        return path.isEmpty ? context.debugDescription : "\(path)：\(context.debugDescription)"
    }
}
