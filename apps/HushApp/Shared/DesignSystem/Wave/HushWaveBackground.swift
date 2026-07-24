import SwiftUI

struct HushWaveBackground: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Color.black

            TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: reduceMotion)) { timeline in
                Canvas { context, size in
                    let elapsed = timeline.date.timeIntervalSinceReferenceDate
                    let phase = reduceMotion
                        ? 0.5
                        : elapsed * .pi * 2 / 10.5
                    let breathPhase = reduceMotion
                        ? 0.0
                        : elapsed * .pi * 2 / 6.8
                    let breath = reduceMotion
                        ? 0.96
                        : 0.92 + sin(breathPhase - .pi / 2) * 0.08
                    let centerY = size.height * 0.82 + sin(breathPhase) * 10
                    let amplitude = min(118, size.height * 0.17) * breath
                    let path = wavePath(
                        size: size,
                        centerY: centerY,
                        amplitude: amplitude,
                        phase: phase
                    )

                    context.drawLayer { glow in
                        glow.addFilter(.blur(radius: 12))
                        glow.stroke(
                            path,
                            with: .color(
                                Color(red: 0.62, green: 0.88, blue: 1.0)
                                    .opacity(0.24)
                            ),
                            style: StrokeStyle(
                                lineWidth: 7,
                                lineCap: .round,
                                lineJoin: .round
                            )
                        )
                    }

                    context.drawLayer { glow in
                        glow.addFilter(.blur(radius: 4))
                        glow.stroke(
                            path,
                            with: .color(
                                Color(red: 0.76, green: 0.94, blue: 1.0)
                                    .opacity(0.36)
                            ),
                            style: StrokeStyle(
                                lineWidth: 3.4,
                                lineCap: .round,
                                lineJoin: .round
                            )
                        )
                    }

                    context.stroke(
                        path,
                        with: .color(Color.white.opacity(0.94)),
                        style: StrokeStyle(
                            lineWidth: 1.35,
                            lineCap: .round,
                            lineJoin: .round
                        )
                    )
                }
            }
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }

    private func wavePath(
        size: CGSize,
        centerY: CGFloat,
        amplitude: CGFloat,
        phase: Double
    ) -> Path {
        guard size.width > 0 else { return Path() }

        var path = Path()
        let step = max(1.0, size.width / 360)

        for x in stride(from: 0.0, through: size.width, by: step) {
            let progress = x / size.width
            let edgeEnvelope = 0.72 + sin(.pi * progress) * 0.28
            let heightVariation =
                0.86 + sin(progress * .pi * 2 - phase * 0.22) * 0.14
            let carrier = sin(progress * .pi * 6 + phase)
            let softHarmonic =
                sin(progress * .pi * 12 + phase * 0.55) * 0.055
            let y = centerY
                + (carrier * heightVariation + softHarmonic)
                    * amplitude
                    * edgeEnvelope

            if x == 0 {
                path.move(to: CGPoint(x: x, y: y))
            } else {
                path.addLine(to: CGPoint(x: x, y: y))
            }
        }

        return path
    }
}
