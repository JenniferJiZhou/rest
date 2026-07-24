import Combine
import SwiftUI

enum UnifiedInboxProvider: String, CaseIterable, Identifiable {
    case feishu
    case dingtalk
    case outlook
    case qqMail

    var id: String { rawValue }

    var title: String {
        switch self {
        case .feishu: return "飞书"
        case .dingtalk: return "钉钉"
        case .outlook: return "Outlook"
        case .qqMail: return "QQ 邮箱"
        }
    }

    var systemImage: String {
        switch self {
        case .feishu: return "message"
        case .dingtalk: return "bubble.left.and.bubble.right"
        case .outlook: return "envelope"
        case .qqMail: return "tray"
        }
    }
}

enum UnifiedInboxPriority: String {
    case urgent
    case normal
    case low
    case uncertain

    var title: String {
        switch self {
        case .urgent: return "重要"
        case .normal: return "普通"
        case .low: return "稍后"
        case .uncertain: return "待确认"
        }
    }
}

struct UnifiedInboxItem: Identifiable {
    let id: String
    let provider: UnifiedInboxProvider
    let sender: String
    let subject: String
    let preview: String
    let receivedAt: String
    let summary: String
    let importantPoints: [String]
    let todos: [String]
    let priority: UnifiedInboxPriority
    let needsReply: Bool
    let initialDraft: String
    let isUnread: Bool
}

@MainActor
final class UnifiedInboxDemoStore: ObservableObject {
    @Published var selectedProvider: UnifiedInboxProvider?
    @Published var selectedItemID: String?
    @Published var draftText = ""
    @Published var sentItemIDs: Set<String> = []
    @Published var isShowingSendConfirmation = false

    let items: [UnifiedInboxItem] = .fixture

    var filteredItems: [UnifiedInboxItem] {
        guard let selectedProvider else { return items }
        return items.filter { $0.provider == selectedProvider }
    }

    var selectedItem: UnifiedInboxItem? {
        guard let selectedItemID else { return nil }
        return items.first { $0.id == selectedItemID }
    }

    func selectProvider(_ provider: UnifiedInboxProvider?) {
        selectedProvider = provider
        selectedItemID = nil
        draftText = ""
    }

    func open(_ item: UnifiedInboxItem) {
        selectedItemID = item.id
        draftText = item.initialDraft
    }

    func closeItem() {
        selectedItemID = nil
        draftText = ""
    }

    func regenerateDraft() {
        guard let item = selectedItem else { return }
        draftText = "\(item.sender)，你好。谢谢你的消息，我已经看到\(item.subject)。我会确认相关信息后尽快回复你。"
    }

    func discardDraft() {
        draftText = ""
    }

    func confirmSend() {
        guard let item = selectedItem else { return }
        sentItemIDs.insert(item.id)
        isShowingSendConfirmation = false
    }
}

struct UnifiedInboxView: View {
    @StateObject private var store = UnifiedInboxDemoStore()
    let onClose: () -> Void

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if let item = store.selectedItem {
                detail(item)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            } else {
                inbox
                    .transition(.move(edge: .leading).combined(with: .opacity))
            }
        }
        .preferredColorScheme(.dark)
        .confirmationDialog(
            "确认发送这份演示草稿？",
            isPresented: $store.isShowingSendConfirmation,
            titleVisibility: .visible
        ) {
            Button("确认发送") {
                store.confirmSend()
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("当前为 Fixture 演示，只会更新本地状态，不会连接真实渠道。")
        }
    }

    private var inbox: some View {
        VStack(spacing: 0) {
            belowSurfaceHeader

            ScrollView {
                VStack(alignment: .leading, spacing: HushSpacing.lg) {
                    fixtureNotice
                    providerPicker

                    VStack(spacing: HushSpacing.sm) {
                        ForEach(store.filteredItems) { item in
                            itemCard(item)
                        }
                    }
                }
                .frame(maxWidth: 760)
                .padding(.horizontal, HushSpacing.lg)
                .padding(.bottom, HushSpacing.xxl)
            }
            .scrollIndicators(.hidden)
        }
    }

    private var belowSurfaceHeader: some View {
        HStack {
            Button(action: onClose) {
                Image(systemName: "chevron.down")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(HushColor.textPrimary)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(Color.white.opacity(0.06)))
                    .overlay(
                        Circle().stroke(HushColor.hairline, lineWidth: 0.8)
                    )
            }
            .buttonStyle(.plain)
            .accessibilityLabel("回到 Hush")

            Spacer()

            Text("消息")
                .font(HushType.bodyStrong)
                .foregroundStyle(HushColor.textPrimary)

            Spacer()

            HushSampleModeBadge()
        }
        .padding(.horizontal, HushSpacing.lg)
        .padding(.vertical, HushSpacing.md)
    }

    private func detail(_ item: UnifiedInboxItem) -> some View {
        VStack(spacing: 0) {
            header(
                title: item.provider.title,
                leadingImage: "chevron.left",
                leadingLabel: "返回消息列表",
                leadingAction: {
                    withAnimation(.easeInOut(duration: 0.24)) {
                        store.closeItem()
                    }
                }
            )

            ScrollView {
                VStack(alignment: .leading, spacing: HushSpacing.lg) {
                    sourceHeader(item)

                    VStack(alignment: .leading, spacing: HushSpacing.sm) {
                        HushSectionLabel(text: "AI 摘要")
                        Text(item.summary)
                            .font(HushType.body)
                            .lineSpacing(5)
                            .foregroundStyle(HushColor.textPrimary)

                        ForEach(item.importantPoints, id: \.self) { point in
                            Label(point, systemImage: "circle.fill")
                                .font(HushType.caption)
                                .foregroundStyle(HushColor.textSecondary)
                                .symbolRenderingMode(.monochrome)
                        }
                    }
                    .hushPanel(emphasized: true)

                    if !item.todos.isEmpty {
                        VStack(alignment: .leading, spacing: HushSpacing.sm) {
                            HushSectionLabel(text: "待办")
                            ForEach(item.todos, id: \.self) { todo in
                                Label(todo, systemImage: "circle")
                                    .font(HushType.body)
                                    .foregroundStyle(HushColor.textPrimary)
                            }
                        }
                        .hushPanel()
                    }

                    draftEditor(item)
                }
                .frame(maxWidth: 760)
                .padding(.horizontal, HushSpacing.lg)
                .padding(.bottom, HushSpacing.xxl)
            }
            .scrollIndicators(.hidden)
        }
    }

    private func header(
        title: String,
        leadingImage: String,
        leadingLabel: String,
        leadingAction: @escaping () -> Void
    ) -> some View {
        HStack {
            Button(action: leadingAction) {
                Image(systemName: leadingImage)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(HushColor.textPrimary)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(Color.white.opacity(0.06)))
                    .overlay(Circle().stroke(HushColor.hairline, lineWidth: 0.8))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(leadingLabel)

            Spacer()

            Text(title)
                .font(HushType.bodyStrong)
                .foregroundStyle(HushColor.textPrimary)

            Spacer()

            HushSampleModeBadge()
        }
        .padding(.horizontal, HushSpacing.lg)
        .padding(.vertical, HushSpacing.md)
    }

    private var fixtureNotice: some View {
        HStack(alignment: .top, spacing: HushSpacing.sm) {
            Image(systemName: "sparkles")
                .foregroundStyle(HushColor.textPrimary)
            Text("这里先用演示消息确认交互。没有读取、上传或发送任何真实消息。")
                .font(HushType.caption)
                .foregroundStyle(HushColor.textSecondary)
        }
        .hushPanel()
    }

    private var providerPicker: some View {
        ScrollView(.horizontal) {
            HStack(spacing: HushSpacing.xs) {
                Button("全部") {
                    store.selectProvider(nil)
                }
                .buttonStyle(HushCompactButtonStyle(selected: store.selectedProvider == nil))

                ForEach(UnifiedInboxProvider.allCases) { provider in
                    Button {
                        store.selectProvider(provider)
                    } label: {
                        Label(provider.title, systemImage: provider.systemImage)
                    }
                    .buttonStyle(
                        HushCompactButtonStyle(
                            selected: store.selectedProvider == provider
                        )
                    )
                }
            }
        }
        .scrollIndicators(.hidden)
    }

    private func itemCard(_ item: UnifiedInboxItem) -> some View {
        Button {
            withAnimation(.easeInOut(duration: 0.24)) {
                store.open(item)
            }
        } label: {
            HStack(alignment: .top, spacing: HushSpacing.md) {
                Image(systemName: item.provider.systemImage)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(HushColor.textPrimary)
                    .frame(width: 38, height: 38)
                    .background(Circle().fill(Color.white.opacity(0.08)))

                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(item.sender)
                            .font(HushType.bodyStrong)
                            .foregroundStyle(HushColor.textPrimary)
                        if item.isUnread {
                            Circle()
                                .fill(Color.white)
                                .frame(width: 5, height: 5)
                        }
                        Spacer()
                        Text(item.receivedAt)
                            .font(HushType.micro)
                            .foregroundStyle(HushColor.textSecondary)
                    }

                    Text(item.subject)
                        .font(HushType.body)
                        .foregroundStyle(HushColor.textPrimary)
                        .lineLimit(1)

                    Text(item.preview)
                        .font(HushType.caption)
                        .foregroundStyle(HushColor.textSecondary)
                        .lineLimit(2)

                    HStack(spacing: HushSpacing.xs) {
                        Text(item.provider.title)
                        Text("·")
                        Text(item.priority.title)
                        if item.needsReply {
                            Text("· 需要回复")
                        }
                    }
                    .font(HushType.micro)
                    .foregroundStyle(HushColor.textSecondary)
                }
            }
            .contentShape(Rectangle())
            .hushPanel()
        }
        .buttonStyle(.plain)
    }

    private func sourceHeader(_ item: UnifiedInboxItem) -> some View {
        VStack(alignment: .leading, spacing: HushSpacing.sm) {
            HStack {
                Label(item.provider.title, systemImage: item.provider.systemImage)
                    .font(HushType.caption)
                    .foregroundStyle(HushColor.textSecondary)
                Spacer()
                Text(item.receivedAt)
                    .font(HushType.micro)
                    .foregroundStyle(HushColor.textSecondary)
            }

            Text(item.subject)
                .font(HushType.title)
                .foregroundStyle(HushColor.textPrimary)

            Text(item.sender)
                .font(HushType.bodyStrong)
                .foregroundStyle(HushColor.textSecondary)

            Text(item.preview)
                .font(HushType.body)
                .lineSpacing(5)
                .foregroundStyle(HushColor.textPrimary)
        }
        .hushPanel()
    }

    private func draftEditor(_ item: UnifiedInboxItem) -> some View {
        VStack(alignment: .leading, spacing: HushSpacing.md) {
            HStack {
                HushSectionLabel(text: "回复草稿")
                Spacer()
                Text(store.sentItemIDs.contains(item.id) ? "演示已发送" : "可编辑")
                    .font(HushType.micro)
                    .foregroundStyle(HushColor.textSecondary)
            }

            TextEditor(text: $store.draftText)
                .font(HushType.body)
                .foregroundStyle(HushColor.textPrimary)
                .scrollContentBackground(.hidden)
                .padding(HushSpacing.sm)
                .frame(minHeight: 150)
                .background(
                    RoundedRectangle(cornerRadius: HushRadius.medium)
                        .fill(Color.white.opacity(0.045))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: HushRadius.medium)
                        .stroke(HushColor.hairline, lineWidth: 1)
                )

            HStack(spacing: HushSpacing.sm) {
                Button("重新生成") {
                    store.regenerateDraft()
                }
                .buttonStyle(HushSecondaryButtonStyle())

                Button("放弃草稿") {
                    store.discardDraft()
                }
                .buttonStyle(HushSecondaryButtonStyle())
            }

            Button(store.sentItemIDs.contains(item.id) ? "演示已发送" : "检查并确认发送") {
                store.isShowingSendConfirmation = true
            }
            .buttonStyle(HushPrimaryButtonStyle())
            .disabled(
                store.draftText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    || store.sentItemIDs.contains(item.id)
            )

            Text("真实发送尚未接入。AI 不持有渠道凭据，也不能替你确认发送。")
                .font(HushType.micro)
                .foregroundStyle(HushColor.textSecondary)
        }
        .hushPanel(emphasized: true)
    }
}

private extension Array where Element == UnifiedInboxItem {
    static let fixture: [UnifiedInboxItem] = [
        UnifiedInboxItem(
            id: "fixture-feishu-1",
            provider: .feishu,
            sender: "产品讨论组",
            subject: "明天下午的演示顺序",
            preview: "大家把各自的演示片段控制在三分钟以内，Jennifer 最后展示 Hush 的完整流程。",
            receivedAt: "刚刚",
            summary: "团队确认了明天下午的演示安排。你负责最后展示 Hush，需要准备一段不超过三分钟的完整流程。",
            importantPoints: ["你的演示排在最后", "单段展示不超过三分钟"],
            todos: ["今晚确认最终演示路径", "明早在真机上完整走一遍"],
            priority: .urgent,
            needsReply: true,
            initialDraft: "收到，我今晚会确认最终流程，明早再用真机完整测试一遍。",
            isUnread: true
        ),
        UnifiedInboxItem(
            id: "fixture-outlook-1",
            provider: .outlook,
            sender: "Alex Chen",
            subject: "Hush demo review",
            preview: "Could you share the latest interaction flow before tomorrow morning? I will leave comments in the deck.",
            receivedAt: "12 分钟前",
            summary: "Alex 希望在明早前收到最新版交互流程，并会在演示文稿中留下反馈。",
            importantPoints: ["截止时间是明早", "对方会直接在演示文稿中反馈"],
            todos: ["发送最新版交互流程链接"],
            priority: .normal,
            needsReply: true,
            initialDraft: "Hi Alex, I’ll send you the latest interaction flow later today. Thanks for reviewing it before tomorrow.",
            isUnread: true
        ),
        UnifiedInboxItem(
            id: "fixture-dingtalk-1",
            provider: .dingtalk,
            sender: "开发协作群",
            subject: "Agent HTTPS 部署",
            preview: "后端本地契约测试已经通过，公网 HTTPS 地址会在部署完成后发到群里。",
            receivedAt: "38 分钟前",
            summary: "Agent 本地测试已通过，但公网 HTTPS 服务仍在部署中。地址发出后才能进行 Apple 客户端端到端测试。",
            importantPoints: ["本地契约测试通过", "仍需等待公网 HTTPS 地址"],
            todos: [],
            priority: .normal,
            needsReply: false,
            initialDraft: "",
            isUnread: false
        ),
        UnifiedInboxItem(
            id: "fixture-qq-1",
            provider: .qqMail,
            sender: "Adventure X",
            subject: "参赛信息确认",
            preview: "请再次确认团队名称、成员信息和现场联系人电话是否准确。",
            receivedAt: "昨天",
            summary: "主办方要求确认团队资料和现场联系人信息。邮件未要求立即回复。",
            importantPoints: ["需要核对团队名称和成员信息"],
            todos: ["和团队成员确认报名资料"],
            priority: .low,
            needsReply: true,
            initialDraft: "您好，我们会再次核对团队资料，并在确认后回复。谢谢。",
            isUnread: false
        )
    ]
}
