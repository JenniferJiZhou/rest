import SwiftUI
#if os(macOS)
import AppKit
#endif

struct HushDoorView: View {
    let taskText: String
    let onOpenTask: () -> Void
    let onSettings: () -> Void
    /// Fired once when a clear upward swipe crosses a small threshold. The swipe
    /// is only an ignition signal: after this the tide plays its own fixed
    /// timeline and never reads the finger again.
    var onInboxSwipeTriggered: (() -> Void)?
    var onOpenCompanion: (() -> Void)?
    /// Fired by a long press held on the water itself. The breath is offered
    /// from the place it will happen, so there is no button to find and nothing
    /// added to the door's surface.
    var onBreathLongPress: (() -> Void)?

    /// Tiny self-contained "arming" feedback (0…1) as the finger rises toward the
    /// threshold — a brightening, lifting chevron. Deliberately NOT the water:
    /// the gesture arms the tide, it does not drag it up.
    @State private var armProgress: CGFloat = 0
    /// One-shot latch so a single swipe ignites the tide exactly once, even
    /// though drag callbacks keep arriving while the finger is still moving.
    @State private var hasTriggered = false
    /// Held-press feedback on the water. The only cue is the chevron settling,
    /// so the door gains no new furniture for a gesture most users never use.
    @State private var breathPressed = false

    /// A light push is enough — ~44 pt of rise, or a clear upward flick, arms it.
    /// The user never has to drag the water all the way up.
    private let triggerDistance: CGFloat = 44
    private let triggerVelocity: CGFloat = 450

    var body: some View {
        GeometryReader { geometry in
            let taskWidth = min(300, geometry.size.width - 88)

            ZStack(alignment: .topTrailing) {
                // The water band, listening for a held press. It sits at the
                // bottom of the stack so the task text and the controls keep
                // their taps, and it carries no gesture of its own beyond the
                // hold — the upward swipe above still reaches the door.
                if onBreathLongPress != nil {
                    Color.clear
                        .contentShape(Rectangle())
                        .frame(
                            width: geometry.size.width,
                            height: geometry.size.height * 0.38
                        )
                        .position(
                            x: geometry.size.width * 0.5,
                            y: geometry.size.height * 0.81
                        )
                        .onLongPressGesture(minimumDuration: 0.55) {
                            breathPressed = false
                            onBreathLongPress?()
                        } onPressingChanged: { pressing in
                            withAnimation(.easeOut(duration: 0.25)) {
                                breathPressed = pressing
                            }
                        }
                        .accessibilityLabel("跟随潮水呼吸")
                        .accessibilityHint("长按水面开始")
                        .accessibilityAddTraits(.isButton)
                }

                Button(action: onOpenTask) {
                    HushTypewriterText(text: taskText)
                        .frame(
                            width: taskWidth,
                            alignment: .leading
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(taskText)
                .accessibilityHint("打开任务详情")
                .position(
                    x: 44 + taskWidth / 2,
                    y: geometry.size.height * 0.545
                )

                HStack(spacing: HushSpacing.xs) {
                    if let onOpenCompanion {
                        Button(action: onOpenCompanion) {
                            Image(systemName: "sun.max.fill")
                                .font(.system(size: 14, weight: .regular))
                                .foregroundStyle(Color.white.opacity(0.82))
                                .frame(width: 34, height: 34)
                                .background(
                                    Circle().fill(Color.white.opacity(0.035))
                                )
                                .overlay(
                                    Circle().stroke(
                                        Color.white.opacity(0.12),
                                        lineWidth: 0.8
                                    )
                                )
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("打开常亮陪伴")
                    }

                    Button(action: onSettings) {
                        Image(systemName: "gearshape")
                            .font(.system(size: 15, weight: .regular))
                            .foregroundStyle(Color.white.opacity(0.78))
                            .frame(width: 34, height: 34)
                            .background(
                                Circle().fill(Color.white.opacity(0.035))
                            )
                            .overlay(
                                Circle().stroke(
                                    Color.white.opacity(0.12),
                                    lineWidth: 0.8
                                )
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("设置")
                }
                .padding(.top, HushSpacing.md)
                .padding(.trailing, HushSpacing.lg)

                if onInboxSwipeTriggered != nil {
                    Image(systemName: "chevron.up")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(
                            Color.white.opacity(
                                (0.42 + 0.5 * armProgress) * (breathPressed ? 0.3 : 1)
                            )
                        )
                        .offset(y: -8 * armProgress)
                        .animation(.easeOut(duration: 0.14), value: armProgress)
                        .position(
                            x: geometry.size.width * 0.5,
                            y: geometry.size.height * 0.93
                        )
                        .accessibilityHidden(true)

                    #if os(macOS)
                    HushMacTrackpadSwipeView(
                        onArmChanged: { arm in armProgress = arm },
                        onTriggered: fireTrigger
                    )
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .allowsHitTesting(false)
                    #endif
                }
            }
            .contentShape(Rectangle())
            #if !os(macOS)
            .gesture(inboxSwipeGesture)
            #endif
        }
    }

    /// Ignite the tide once per swipe, then let its own timeline take over.
    private func fireTrigger() {
        guard !hasTriggered else { return }
        hasTriggered = true
        armProgress = 0
        onInboxSwipeTriggered?()
    }

    #if !os(macOS)
    private var inboxSwipeGesture: some Gesture {
        DragGesture(minimumDistance: 6)
            .onChanged { value in
                guard onInboxSwipeTriggered != nil, !hasTriggered else { return }

                let up = max(0, -value.translation.height)
                let upwardVelocity = max(0, -value.velocity.height)
                let isPrimarilyVertical = up > abs(value.translation.width)

                // Arm on a light push: a short rise OR a clear upward flick.
                // Beyond the threshold the finger is ignored entirely — no
                // distance-to-height mapping, so the water never "follows".
                if isPrimarilyVertical,
                   up >= triggerDistance || upwardVelocity >= triggerVelocity {
                    fireTrigger()
                } else {
                    armProgress = min(1, up / triggerDistance)
                }
            }
            .onEnded { _ in
                // Re-arm for a fresh swipe. A trigger that already fired is not
                // undone — the tide owns the animation now — and the door is
                // non-interactive during the transition anyway.
                hasTriggered = false
                withAnimation(.easeOut(duration: 0.25)) { armProgress = 0 }
            }
    }
    #endif
}

#if os(macOS)
private struct HushMacTrackpadSwipeView: NSViewRepresentable {
    /// Arming feedback (0…1) as the two fingers rise toward the threshold.
    let onArmChanged: (CGFloat) -> Void
    /// Fired once per gesture when the rise (or a quick upward flick) arms it.
    let onTriggered: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onArmChanged: onArmChanged, onTriggered: onTriggered)
    }

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        context.coordinator.startMonitoring(for: view)
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        context.coordinator.onArmChanged = onArmChanged
        context.coordinator.onTriggered = onTriggered
        context.coordinator.monitoredView = nsView
    }

    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) {
        coordinator.stopMonitoring()
    }

    final class Coordinator {
        weak var monitoredView: NSView?
        var onArmChanged: (CGFloat) -> Void
        var onTriggered: () -> Void

        private var eventMonitor: Any?
        private var upwardDistance: CGFloat = 0
        private var hasTriggered = false

        // A light push arms it: ~44 pt of accumulated rise, or a single quick
        // upward delta (a flick). The finger is never mapped to water height.
        private let triggerDistance: CGFloat = 44
        private let flickDelta: CGFloat = 14

        init(
            onArmChanged: @escaping (CGFloat) -> Void,
            onTriggered: @escaping () -> Void
        ) {
            self.onArmChanged = onArmChanged
            self.onTriggered = onTriggered
        }

        func startMonitoring(for view: NSView) {
            monitoredView = view
            eventMonitor = NSEvent.addLocalMonitorForEvents(
                matching: .scrollWheel
            ) { [weak self] event in
                self?.handle(event)
                return event
            }
        }

        func stopMonitoring() {
            if let eventMonitor {
                NSEvent.removeMonitor(eventMonitor)
            }
            eventMonitor = nil
        }

        private func handle(_ event: NSEvent) {
            guard
                event.hasPreciseScrollingDeltas,
                event.window === monitoredView?.window
            else {
                return
            }

            // Ignore inertial/momentum scrolling that continues after the
            // fingers lift — arming must come from a deliberate physical push.
            guard event.momentumPhase == [] else {
                return
            }

            if event.phase == .began {
                upwardDistance = 0
                hasTriggered = false
                onArmChanged(0)
            }

            let physicalDelta = event.scrollingDeltaY
                * (event.isDirectionInvertedFromDevice ? 1 : -1)
            upwardDistance = max(0, upwardDistance + physicalDelta)

            if !hasTriggered {
                if upwardDistance >= triggerDistance || physicalDelta >= flickDelta {
                    hasTriggered = true
                    onArmChanged(0)
                    onTriggered()
                } else {
                    onArmChanged(min(1, upwardDistance / triggerDistance))
                }
            }

            if event.phase == .ended || event.phase == .cancelled {
                upwardDistance = 0
                hasTriggered = false
                onArmChanged(0)
            }
        }
    }
}
#endif

private struct HushTypewriterText: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let text: String

    @State private var settledText = ""
    @State private var activeCharacter = ""
    @State private var activeOpacity = 0.0

    var body: some View {
        ZStack(alignment: .topLeading) {
            Text(text)
                .hidden()
                .accessibilityHidden(true)

            Text("\(Text(settledText))\(Text(activeCharacter).foregroundColor(Color.white.opacity(0.94 * activeOpacity)))")
        }
        .font(HushType.agentTask)
        .tracking(0.8)
        .lineSpacing(6)
        .foregroundStyle(Color.white.opacity(0.94))
        .multilineTextAlignment(.leading)
        .fixedSize(horizontal: false, vertical: true)
        .task(id: text) {
            await revealText()
        }
    }

    @MainActor
    private func revealText() async {
        settledText = ""
        activeCharacter = ""
        activeOpacity = 0

        guard !reduceMotion else {
            settledText = text
            return
        }

        do {
            try await Task.sleep(nanoseconds: 220_000_000)
        } catch {
            return
        }

        for character in text {
            guard !Task.isCancelled else { return }

            if character == "\n" {
                settledText.append(character)
                do {
                    try await Task.sleep(nanoseconds: 45_000_000)
                } catch {
                    return
                }
                continue
            }

            activeCharacter = String(character)
            activeOpacity = 0

            withAnimation(.easeOut(duration: 0.085)) {
                activeOpacity = 1
            }

            let cadence: UInt64
            switch character {
            case "，", "、":
                cadence = 125_000_000
            case "。", "！", "？":
                cadence = 180_000_000
            default:
                cadence = 72_000_000
            }

            do {
                try await Task.sleep(nanoseconds: cadence)
            } catch {
                return
            }

            settledText.append(character)
            activeCharacter = ""
            activeOpacity = 0
        }
    }
}
