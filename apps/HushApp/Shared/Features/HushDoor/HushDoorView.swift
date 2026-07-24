import SwiftUI
#if os(macOS)
import AppKit
#endif

struct HushDoorView: View {
    let taskText: String
    let onOpenTask: () -> Void
    let onSettings: () -> Void
    var onInboxSwipeChanged: ((CGFloat) -> Void)?
    var onInboxSwipeEnded: ((Bool) -> Void)?
    var onOpenCompanion: (() -> Void)?

    var body: some View {
        GeometryReader { geometry in
            let taskWidth = min(300, geometry.size.width - 88)

            ZStack(alignment: .topTrailing) {
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

                if onInboxSwipeChanged != nil, onInboxSwipeEnded != nil {
                    Image(systemName: "chevron.up")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.48))
                        .position(
                            x: geometry.size.width * 0.5,
                            y: geometry.size.height * 0.93
                        )
                        .accessibilityHidden(true)

                    #if os(macOS)
                    HushMacTrackpadSwipeView(
                        onProgressChanged: { progress in
                            onInboxSwipeChanged?(progress)
                        },
                        onGestureEnded: { shouldComplete in
                            onInboxSwipeEnded?(shouldComplete)
                        }
                    )
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .allowsHitTesting(false)
                    #endif
                }
            }
            .contentShape(Rectangle())
            #if !os(macOS)
            .gesture(
                DragGesture(minimumDistance: 4)
                    .onChanged { value in
                        let upwardDistance = max(
                            0,
                            -value.translation.height
                        )
                        let progress = min(
                            0.96,
                            upwardDistance
                                / max(1, geometry.size.height * 0.55)
                        )
                        onInboxSwipeChanged?(progress)
                    }
                    .onEnded { value in
                        let upwardDistance = max(
                            0,
                            -value.translation.height
                        )
                        let threshold = geometry.size.height * 0.25
                        let isPrimarilyVertical =
                            upwardDistance > abs(value.translation.width)
                        onInboxSwipeEnded?(
                            upwardDistance >= threshold
                                && isPrimarilyVertical
                        )
                    }
            )
            #endif
        }
    }
}

#if os(macOS)
private struct HushMacTrackpadSwipeView: NSViewRepresentable {
    let onProgressChanged: (CGFloat) -> Void
    let onGestureEnded: (Bool) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(
            onProgressChanged: onProgressChanged,
            onGestureEnded: onGestureEnded
        )
    }

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        context.coordinator.startMonitoring(for: view)
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        context.coordinator.onProgressChanged = onProgressChanged
        context.coordinator.onGestureEnded = onGestureEnded
        context.coordinator.monitoredView = nsView
    }

    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) {
        coordinator.stopMonitoring()
    }

    final class Coordinator {
        weak var monitoredView: NSView?
        var onProgressChanged: (CGFloat) -> Void
        var onGestureEnded: (Bool) -> Void

        private var eventMonitor: Any?
        private var upwardDistance: CGFloat = 0

        init(
            onProgressChanged: @escaping (CGFloat) -> Void,
            onGestureEnded: @escaping (Bool) -> Void
        ) {
            self.onProgressChanged = onProgressChanged
            self.onGestureEnded = onGestureEnded
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
            // fingers lift. Progress must follow the physical two-finger
            // distance only — projected velocity must never bypass the
            // completion threshold or hijack a cancelled return.
            guard event.momentumPhase == [] else {
                return
            }

            if event.phase == .began {
                upwardDistance = 0
                onProgressChanged(0)
            }

            let physicalDelta = event.scrollingDeltaY
                * (event.isDirectionInvertedFromDevice ? 1 : -1)
            upwardDistance = max(0, upwardDistance + physicalDelta)

            let viewHeight = max(
                1,
                monitoredView?.bounds.height
                    ?? monitoredView?.window?.contentView?.bounds.height
                    ?? 1
            )
            let progress = min(
                0.96,
                upwardDistance / (viewHeight * 0.55)
            )
            onProgressChanged(progress)

            if event.phase == .ended || event.phase == .cancelled {
                let shouldComplete =
                    event.phase != .cancelled
                    && upwardDistance >= viewHeight * 0.25
                onGestureEnded(shouldComplete)
                upwardDistance = 0
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
