import ActivityKit
import SwiftUI
import WidgetKit

struct HushRestLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: HushRestAttributes.self) { context in
            HStack(spacing: 14) {
                Image(systemName: "moon.zzz.fill")
                    .font(.title2)
                    .foregroundStyle(.indigo)

                VStack(alignment: .leading, spacing: 4) {
                    Text(context.attributes.sessionName)
                        .font(.headline)
                    sessionStatus(context.state)
                }

                Spacer(minLength: 8)
            }
            .padding()
            .activityBackgroundTint(.indigo.opacity(0.12))
            .activitySystemActionForegroundColor(.indigo)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "moon.zzz.fill")
                        .foregroundStyle(.indigo)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.sessionName)
                        .font(.headline)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    sessionStatus(context.state)
                }
            } compactLeading: {
                Image(systemName: "moon.zzz.fill")
                    .foregroundStyle(.indigo)
            } compactTrailing: {
                compactStatus(context.state)
            } minimal: {
                Image(systemName: "moon.zzz.fill")
                    .foregroundStyle(.indigo)
            }
            .keylineTint(.indigo)
        }
    }

    @ViewBuilder
    private func sessionStatus(
        _ state: HushRestAttributes.ContentState
    ) -> some View {
        switch state.phase {
        case .running:
            if let endDate = state.expectedEndDate {
                Text(
                    timerInterval: Date.now...max(Date.now, endDate),
                    countsDown: true
                )
                .font(.title3.monospacedDigit())
            } else {
                Text("休息中")
                    .font(.subheadline)
            }
        case .paused:
            Label(
                "\(formattedTime(state.remainingSeconds)) · 已暂停",
                systemImage: "pause.fill"
            )
            .font(.subheadline.monospacedDigit())
        case .completed:
            Label("休息完成", systemImage: "checkmark.circle.fill")
                .font(.subheadline)
        case .ended:
            Text("本次休息已结束")
                .font(.subheadline)
        }
    }

    @ViewBuilder
    private func compactStatus(
        _ state: HushRestAttributes.ContentState
    ) -> some View {
        switch state.phase {
        case .running:
            if let endDate = state.expectedEndDate {
                Text(
                    timerInterval: Date.now...max(Date.now, endDate),
                    countsDown: true
                )
                .monospacedDigit()
                .frame(maxWidth: 48)
            } else {
                Text("休息")
            }
        case .paused:
            Image(systemName: "pause.fill")
        case .completed:
            Image(systemName: "checkmark")
        case .ended:
            Image(systemName: "xmark")
        }
    }

    private func formattedTime(_ seconds: Int) -> String {
        String(
            format: "%d:%02d",
            max(0, seconds) / 60,
            max(0, seconds) % 60
        )
    }
}

@main
struct HushRestLiveActivityBundle: WidgetBundle {
    var body: some Widget {
        HushRestLiveActivity()
    }
}
