import Foundation

enum UnifiedInboxPlatform: Sendable {
    case iOS
    case macOS
}

enum UnifiedInboxConfigurationError: Error {
    case invalidBaseURL
    case invalidAppToken
}

struct UnifiedInboxRuntimeConfiguration: Sendable {
    let baseURL: URL
    let appToken: String

    init(
        baseURL: URL,
        appToken: String,
        platform: UnifiedInboxPlatform = {
            #if os(macOS)
            return .macOS
            #else
            return .iOS
            #endif
        }()
    ) throws {
        guard Self.isAllowed(baseURL, on: platform) else {
            throw UnifiedInboxConfigurationError.invalidBaseURL
        }
        guard appToken.count >= 32 else {
            throw UnifiedInboxConfigurationError.invalidAppToken
        }
        self.baseURL = baseURL
        self.appToken = appToken
    }

    private static func isAllowed(
        _ url: URL,
        on platform: UnifiedInboxPlatform
    ) -> Bool {
        guard
            let scheme = url.scheme?.lowercased(),
            let host = url.host,
            url.user == nil,
            url.password == nil
        else {
            return false
        }
        if scheme == "https" {
            return true
        }
        guard scheme == "http" else {
            return false
        }
        switch platform {
        case .macOS:
            return host == "localhost" || host == "127.0.0.1" || host == "::1"
        case .iOS:
            return isPrivateIPv4(host)
        }
    }

    private static func isPrivateIPv4(_ host: String) -> Bool {
        let parts = host.split(separator: ".").compactMap { Int($0) }
        guard parts.count == 4, parts.allSatisfy({ (0...255).contains($0) }) else {
            return false
        }
        return parts[0] == 10
            || (parts[0] == 172 && (16...31).contains(parts[1]))
            || (parts[0] == 192 && parts[1] == 168)
    }
}
