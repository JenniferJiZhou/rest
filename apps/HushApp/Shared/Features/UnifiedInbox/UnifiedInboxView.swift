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

enum UnifiedInboxViewSource {
    case sample
    case real(UnifiedInboxViewModel)
}

struct UnifiedInboxView: View {
    let onClose: () -> Void
    var reveal: HushTideReveal = .settled
    var source: UnifiedInboxViewSource = .sample

    var body: some View {
        switch source {
        case .sample:
            UnifiedInboxSampleView(onClose: onClose, reveal: reveal)
        case .real(let model):
            UnifiedInboxRealView(
                model: model,
                onClose: onClose,
                reveal: reveal
            )
        }
    }
}

private struct UnifiedInboxRealView: View {
    @ObservedObject var model: UnifiedInboxViewModel
    let onClose: () -> Void
    var reveal: HushTideReveal
    @State private var draftText = ""

    var body: some View {
        ZStack {
            HushTidePageSurface(progress: reveal.progress)
            VStack(spacing: 0) {
                header
                content
            }
        }
        .preferredColorScheme(.dark)
        .task {
            if model.loadState == .idle {
                await model.load()
            }
        }
        .onChange(of: model.draft?.content) { _, value in
            draftText = value ?? ""
        }
    }

    private var header: some View {
        HStack {
            Button(action: onClose) {
                Image(systemName: "chevron.down")
                    .frame(width: 34, height: 34)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("回到 Hush")

            Spacer()
            Text("消息")
                .font(HushType.bodyStrong)
            Spacer()

            Label(originTitle, systemImage: originImage)
                .font(HushType.caption)
                .foregroundStyle(HushColor.textSecondary)
        }
        .foregroundStyle(HushColor.textPrimary)
        .padding(.horizontal, HushSpacing.lg)
        .padding(.vertical, HushSpacing.md)
    }

    @ViewBuilder
    private var content: some View {
        if let item = model.selectedItem {
            detail(item)
        } else {
            list
        }
    }

    private var list: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HushSpacing.md) {
                readiness
                switch model.loadState {
                case .idle, .loading:
                    ProgressView().frame(maxWidth: .infinity)
                case .empty:
                    stateMessage("消息已同步，目前没有待处理内容。")
                case .failed(let message):
                    stateMessage(message)
                    Button("重试") { Task { await model.refresh() } }
                        .buttonStyle(.bordered)
                case .loaded:
                    ForEach(model.items) { item in
                        Button {
                            Task { await model.open(item.id) }
                        } label: {
                            VStack(alignment: .leading, spacing: HushSpacing.xs) {
                                HStack {
                                    Text(providerTitle(item.provider))
                                        .font(HushType.caption)
                                    Spacer()
                                    Text(item.receivedAt)
                                        .font(HushType.caption)
                                }
                                Text(item.subject ?? item.conversationName)
                                    .font(HushType.bodyStrong)
                                Text(item.summary ?? item.content ?? "等待摘要")
                                    .font(HushType.caption)
                                    .lineLimit(3)
                            }
                            .foregroundStyle(HushColor.textPrimary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .hushPanel()
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .frame(maxWidth: 760)
            .padding(HushSpacing.lg)
        }
    }

    private var readiness: some View {
        VStack(alignment: .leading, spacing: HushSpacing.xs) {
            HushSectionLabel(text: "渠道状态")
            ForEach(Array(model.providerReadiness.enumerated()), id: \.offset) { _, value in
                HStack {
                    Text(providerTitle(value.provider))
                    Spacer()
                    Text(readinessTitle(value.status))
                        .foregroundStyle(
                            value.status == .ready
                                ? HushColor.textSecondary
                                : Color.orange
                        )
                }
                .font(HushType.caption)
            }
        }
        .hushPanel()
    }

    private func detail(_ item: UnifiedInboxPresentedItem) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HushSpacing.md) {
                Button {
                    model.closeItem()
                } label: {
                    Label("返回消息列表", systemImage: "chevron.left")
                }
                .buttonStyle(.plain)

                VStack(alignment: .leading, spacing: HushSpacing.sm) {
                    Text(providerTitle(item.provider))
                        .font(HushType.caption)
                        .foregroundStyle(HushColor.textSecondary)
                    Text(item.conversationName).font(HushType.title)
                    if let sender = item.sender { Text(sender) }
                    if let subject = item.subject { Text(subject).font(HushType.bodyStrong) }
                    if let summary = item.summary { Text(summary) }
                    ForEach(item.importantPoints, id: \.self) { Text("• \($0)") }
                    ForEach(item.replyTargets, id: \.displayName) { target in
                        Text("回复 \(target.displayName)：\(target.reason)")
                            .font(HushType.caption)
                    }
                }
                .foregroundStyle(HushColor.textPrimary)
                .hushPanel(emphasized: true)

                Button("确认已读") {
                    Task { await model.acknowledgeSelected() }
                }
                .buttonStyle(.bordered)
                .disabled(model.isMutationInFlight)

                if let draft = model.draft {
                    VStack(alignment: .leading, spacing: HushSpacing.sm) {
                        HushSectionLabel(text: "回复草稿 · v\(draft.version)")
                        TextEditor(text: $draftText)
                            .frame(minHeight: 120)
                            .scrollContentBackground(.hidden)
                            .disabled(editorLocked)
                        HStack {
                            Button("保存修改") {
                                Task { await model.updateDraft(content: draftText) }
                            }
                            .disabled(
                                draftText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                    || model.sendState == .unknown
                                    || model.sendState == .sent
                                    || model.isMutationInFlight
                            )
                            Spacer()
                            sendControls
                        }
                    }
                    .hushPanel()
                } else if item.hasDraft {
                    Button("加载回复草稿") {
                        Task { await model.loadDraft() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.isMutationInFlight)
                }

                sendStatus
            }
            .frame(maxWidth: 760)
            .padding(HushSpacing.lg)
        }
    }

    @ViewBuilder
    private var sendControls: some View {
        Group {
            switch model.sendState {
            case .idle, .failed:
                Button("检查发送") {
                    model.beginReview(displayedContent: draftText)
                }
            case .sent, .unknown:
                EmptyView()
            case .reviewing:
                Button("获取确认") { Task { await model.requestConfirmation() } }
            case .confirming:
                Button("确认发送") { Task { await model.sendConfirmedDraft() } }
            case .sending:
                ProgressView()
            }
        }
        .frame(width: 112, height: 36)
        .disabled(
            (model.isMutationInFlight && model.sendState != .sending)
                || hasUnsavedDraftChanges
        )
    }

    @ViewBuilder
    private var sendStatus: some View {
        switch model.sendState {
        case .sent: stateMessage("已发送。")
        case .failed(let message): stateMessage(message)
        case .unknown: stateMessage("发送结果未知。请先到对应渠道确认，不要重复发送。")
        default: EmptyView()
        }
    }

    private func stateMessage(_ text: String) -> some View {
        Text(text)
            .font(HushType.body)
            .foregroundStyle(HushColor.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, HushSpacing.md)
    }

    private var originTitle: String {
        if case .failed = model.loadState { return "连接失败" }
        return model.origin == .real ? "实时" : "未验证"
    }

    private var originImage: String {
        if case .failed = model.loadState {
            return "exclamationmark.shield"
        }
        return model.origin == .real
            ? "checkmark.shield"
            : "exclamationmark.shield"
    }

    private var hasUnsavedDraftChanges: Bool {
        guard let draft = model.draft else { return false }
        return draftText != draft.content
    }

    private var editorLocked: Bool {
        switch model.sendState {
        case .reviewing, .confirming, .sending, .sent, .unknown:
            return true
        case .idle, .failed:
            return model.isMutationInFlight
        }
    }

    private func providerTitle(_ provider: InboxProviderResponse) -> String {
        switch provider {
        case .feishu: "飞书"
        case .dingtalk: "钉钉"
        case .outlook: "Outlook"
        case .qqMail: "QQ 邮箱"
        }
    }

    private func readinessTitle(_ status: InboxSyncStateResponse) -> String {
        switch status {
        case .ready: "已就绪"
        case .degraded: "部分可用"
        case .unavailable: "不可用"
        case .unknown: "未知"
        }
    }
}

private struct UnifiedInboxSampleView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @StateObject private var store = UnifiedInboxDemoStore()
    let onClose: () -> Void

    /// Tide clock. `.settled` (the default) presents an ordinary interactive
    /// inbox — the surface is solid and every row reads fully revealed. During
    /// the transition it carries the water progress (for the reading surface)
    /// and the elapsed seconds (for the tight message cadence). See
    /// `HushTideTimeline`.
    var reveal: HushTideReveal = .settled

    var body: some View {
        ZStack {
            HushTidePageSurface(progress: reveal.progress)

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
        // Reveal order top → bottom: header, notice, picker, then each card.
        // Each row's index is its vertical slot; the tide's tight cadence opens
        // them in that order, ~0.06 s apart, so the list reads as one continuous
        // downward stream left in the water's wake — see `HushTideTimeline`.
        let items = store.filteredItems
        let elapsed = reveal.elapsed

        return VStack(spacing: 0) {
            belowSurfaceHeader
                .hushTideReveal(
                    index: 0,
                    elapsed: elapsed,
                    reduceMotion: reduceMotion
                )

            ScrollView {
                VStack(alignment: .leading, spacing: HushSpacing.lg) {
                    fixtureNotice
                        .hushTideReveal(
                            index: 1,
                            elapsed: elapsed,
                            reduceMotion: reduceMotion
                        )
                    providerPicker
                        .hushTideReveal(
                            index: 2,
                            elapsed: elapsed,
                            reduceMotion: reduceMotion
                        )

                    VStack(spacing: HushSpacing.sm) {
                        ForEach(Array(items.enumerated()), id: \.element.id) { offset, item in
                            itemCard(item)
                                .hushTideReveal(
                                    index: 3 + offset,
                                    elapsed: elapsed,
                                    reduceMotion: reduceMotion
                                )
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
                        HushSectionLabel(text: "演示摘要")
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
                Button("重置演示草稿") {
                    store.regenerateDraft()
                }
                .buttonStyle(HushSecondaryButtonStyle())

                Button("放弃草稿") {
                    store.discardDraft()
                }
                .buttonStyle(HushSecondaryButtonStyle())
            }

            Button(store.sentItemIDs.contains(item.id) ? "演示已发送" : "模拟确认发送") {
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
