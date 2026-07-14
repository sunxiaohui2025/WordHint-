import Foundation
import Network
import SwiftData
import Darwin

@MainActor
final class LANSyncServer: ObservableObject {
    @Published private(set) var isRunning = false
    @Published private(set) var address = ""
    @Published var lastReport: ImportReport?
    @Published var errorMessage: String?
    private var listener: NWListener?
    private var context: ModelContext?

    func start(context: ModelContext) {
        guard listener == nil else { return }
        self.context = context
        do {
            let listener = try NWListener(using: .tcp, on: .any)
            listener.newConnectionHandler = { [weak self] in self?.handle($0) }
            listener.stateUpdateHandler = { [weak self] state in
                Task { @MainActor in
                    guard let self else { return }
                    switch state {
                    case .ready:
                        self.isRunning = true
                        self.address = "http://\(Self.localIPAddress() ?? "本机IP"):\(listener.port?.rawValue ?? 0)/api/import"
                    case .failed(let error):
                        self.errorMessage = error.localizedDescription
                        self.stop()
                    default: break
                    }
                }
            }
            listener.start(queue: .global(qos: .userInitiated)); self.listener = listener
        } catch { errorMessage = error.localizedDescription }
    }

    func stop() { listener?.cancel(); listener = nil; isRunning = false; address = "" }

    private nonisolated func handle(_ connection: NWConnection) {
        connection.start(queue: .global(qos: .userInitiated))
        receive(on: connection, accumulated: Data())
    }

    private nonisolated func receive(on connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 1_048_576) { [weak self] data, _, complete, error in
            var all = accumulated; if let data { all.append(data) }
            if complete || error != nil || Self.requestIsComplete(all) { self?.process(all, connection: connection) }
            else { self?.receive(on: connection, accumulated: all) }
        }
    }

    private nonisolated func process(_ request: Data, connection: NWConnection) {
        guard let separator = request.range(of: Data("\r\n\r\n".utf8)) else { respond(connection, status: 400, body: "{\"error\":\"bad request\"}"); return }
        let header = String(decoding: request[..<separator.lowerBound], as: UTF8.self)
        if header.hasPrefix("OPTIONS /api/import ") { respond(connection, status: 204, body: ""); return }
        guard header.hasPrefix("POST /api/import ") else { respond(connection, status: 404, body: "{\"error\":\"not found\"}"); return }
        let body = request[separator.upperBound...]
        Task { @MainActor [weak self] in
            guard let self, let context else { return }
            do {
                let report = try ImportService.importData(Data(body), into: context); lastReport = report
                let encoded = try JSONEncoder().encode(report); respond(connection, status: 200, body: String(decoding: encoded, as: UTF8.self))
            } catch { errorMessage = error.localizedDescription; respond(connection, status: 400, body: "{\"error\":\"\(Self.escape(error.localizedDescription))\"}") }
        }
    }

    private nonisolated func respond(_ connection: NWConnection, status: Int, body: String) {
        let reason = status == 200 ? "OK" : status == 204 ? "No Content" : "Error"
        let response = "HTTP/1.1 \(status) \(reason)\r\nContent-Type: application/json; charset=utf-8\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
        connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in connection.cancel() })
    }

    private nonisolated static func requestIsComplete(_ data: Data) -> Bool {
        guard let split = data.range(of: Data("\r\n\r\n".utf8)) else { return false }
        let header = String(decoding: data[..<split.lowerBound], as: UTF8.self).lowercased()
        if header.hasPrefix("options ") { return true }
        guard let line = header.components(separatedBy: "\r\n").first(where: { $0.hasPrefix("content-length:") }), let length = Int(line.split(separator: ":").last?.trimmingCharacters(in: .whitespaces) ?? "") else { return false }
        return data.count - split.upperBound >= length
    }

    private nonisolated static func escape(_ value: String) -> String { value.replacingOccurrences(of: "\"", with: "'") }
    private nonisolated static func localIPAddress() -> String? {
        var address: String?; var interfaces: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&interfaces) == 0 else { return nil }; defer { freeifaddrs(interfaces) }
        for pointer in sequence(first: interfaces, next: { $0?.pointee.ifa_next }) {
            guard let interface = pointer?.pointee, interface.ifa_addr.pointee.sa_family == UInt8(AF_INET), String(cString: interface.ifa_name) == "en0" else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST)); var addr = interface.ifa_addr.pointee
            getnameinfo(&addr, socklen_t(interface.ifa_addr.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST)
            address = String(cString: host)
        }
        return address
    }
}
