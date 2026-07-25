import SwiftUI

enum UnifiedInboxModeSelection: Equatable {
    case configuration
    case real
    case sample
}

@MainActor
final class UnifiedInboxModeCoordinator: ObservableObject {
    @Published private(set) var selection: UnifiedInboxModeSelection
    @Published private(set) var realModel: UnifiedInboxViewModel?
    @Published var baseURLText: String
    @Published var tokenInput: String
    @Published private(set) var errorMessage: String?

    private static let baseURLKey = "unified.inbox.baseURL"
    private let defaults: UserDefaults
    private let clientFactory: (UnifiedInboxRuntimeConfiguration) -> any UnifiedInboxClient

    init(
        defaults: UserDefaults = .standard,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        clientFactory: @escaping (UnifiedInboxRuntimeConfiguration) -> any UnifiedInboxClient = {
            UnifiedInboxAPIClient(configuration: $0)
        }
    ) {
        self.defaults = defaults
        self.clientFactory = clientFactory
        baseURLText = environment["HUSH_INBOX_BASE_URL"]
            ?? defaults.string(forKey: Self.baseURLKey)
            ?? ""
        tokenInput = environment["HUSH_APP_TOKEN"] ?? ""
        selection = .configuration

        if let configuration = try? Self.configuration(
            baseURLText: baseURLText,
            token: tokenInput
        ) {
            realModel = UnifiedInboxViewModel(
                client: clientFactory(configuration)
            )
            selection = .real
            defaults.set(baseURLText, forKey: Self.baseURLKey)
        }
    }

    var hasRuntimeToken: Bool { !tokenInput.isEmpty }

    func connect() {
        do {
            let configuration = try Self.configuration(
                baseURLText: baseURLText,
                token: tokenInput
            )
            realModel = UnifiedInboxViewModel(
                client: clientFactory(configuration)
            )
            defaults.set(
                baseURLText.trimmingCharacters(in: .whitespacesAndNewlines),
                forKey: Self.baseURLKey
            )
            errorMessage = nil
            selection = .real
        } catch {
            realModel = nil
            errorMessage = "请输入允许的服务地址和至少 32 位 App Token。"
            selection = .configuration
        }
    }

    func selectSample() {
        clearRealSession()
        selection = .sample
    }

    func showConfiguration() {
        clearRealSession()
        selection = .configuration
    }

    func updateBaseURL(_ value: String) {
        if selection == .real {
            clearRealSession()
            selection = .configuration
        }
        baseURLText = value
    }

    private func clearRealSession() {
        tokenInput = ""
        realModel = nil
        errorMessage = nil
    }

    private static func configuration(
        baseURLText: String,
        token: String
    ) throws -> UnifiedInboxRuntimeConfiguration {
        let trimmed = baseURLText.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard let url = URL(string: trimmed) else {
            throw UnifiedInboxConfigurationError.invalidBaseURL
        }
        return try UnifiedInboxRuntimeConfiguration(
            baseURL: url,
            appToken: token
        )
    }
}

struct UnifiedInboxConnectionView: View {
    @ObservedObject var coordinator: UnifiedInboxModeCoordinator
    let onClose: () -> Void
    var reveal: HushTideReveal = .settled

    var body: some View {
        Group {
            switch coordinator.selection {
            case .configuration:
                configuration
            case .sample:
                UnifiedInboxView(
                    onClose: onClose,
                    reveal: reveal,
                    source: .sample
                )
                .overlay(alignment: .bottomTrailing) { modeButton }
            case .real:
                if let model = coordinator.realModel {
                    UnifiedInboxView(
                        onClose: onClose,
                        reveal: reveal,
                        source: .real(model)
                    )
                    .overlay(alignment: .bottomTrailing) { modeButton }
                } else {
                    configuration
                }
            }
        }
    }

    private var configuration: some View {
        ZStack {
            HushTidePageSurface(progress: reveal.progress)
            ScrollView {
                VStack(alignment: .leading, spacing: HushSpacing.lg) {
                    HStack {
                        Button(action: onClose) {
                            Image(systemName: "chevron.down")
                                .frame(width: 34, height: 34)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("回到 Hush")
                        Spacer()
                        Text("连接消息服务").font(HushType.bodyStrong)
                        Spacer()
                        Color.clear.frame(width: 34, height: 34)
                    }

                    VStack(alignment: .leading, spacing: HushSpacing.md) {
                        TextField(
                            "https://inbox.example.com",
                            text: Binding(
                                get: { coordinator.baseURLText },
                                set: coordinator.updateBaseURL
                            )
                        )
                        .textFieldStyle(.roundedBorder)
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        #endif
                        .autocorrectionDisabled()

                        SecureField("HUSH_APP_TOKEN", text: $coordinator.tokenInput)
                            .textFieldStyle(.roundedBorder)

                        if let error = coordinator.errorMessage {
                            Text(error)
                                .font(HushType.caption)
                                .foregroundStyle(Color.orange)
                        }

                        Button("连接") { coordinator.connect() }
                            .buttonStyle(.borderedProminent)
                            .disabled(
                                coordinator.baseURLText.isEmpty
                                    || coordinator.tokenInput.isEmpty
                            )
                    }
                    .hushPanel(emphasized: true)

                    Button("进入 Sample Mode") {
                        coordinator.selectSample()
                    }
                    .buttonStyle(.bordered)
                }
                .foregroundStyle(HushColor.textPrimary)
                .frame(maxWidth: 620)
                .padding(HushSpacing.lg)
            }
        }
        .preferredColorScheme(.dark)
    }

    private var modeButton: some View {
        Button {
            coordinator.showConfiguration()
        } label: {
            Image(systemName: "gearshape")
                .frame(width: 40, height: 40)
                .background(.ultraThinMaterial, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("消息连接设置")
        .padding(HushSpacing.lg)
    }
}
