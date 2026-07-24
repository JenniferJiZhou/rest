import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

struct HushWaveBackground: View, Animatable {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var idleStartedAt = Date()

    var revealProgress: CGFloat = 0

    var animatableData: CGFloat {
        get { revealProgress }
        set { revealProgress = newValue }
    }

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            let progress = min(1, max(0, revealProgress))

            ZStack {
                Color.black

                TimelineView(
                    .animation(
                        minimumInterval: 1.0 / 30.0,
                        paused: reduceMotion || progress > 0.001
                    )
                ) { timeline in
                    idleKeyframePlate(
                        size: size,
                        elapsed: reduceMotion || progress > 0.001
                            ? 0
                            : timeline.date.timeIntervalSince(idleStartedAt)
                    )
                    .offset(y: -size.height * 0.09 * min(progress / 0.34, 1))
                    .opacity(plateOpacity(index: 0, progress: progress))
                }

                keyframePlate(
                    named: "hush-wave-keyframe-02",
                    size: size
                )
                .modifier(
                    KeyframeRevealModifier(
                        opacity: plateOpacity(index: 1, progress: progress),
                        reveal: plateReveal(index: 1, progress: progress),
                        size: size
                    )
                )

                keyframePlate(
                    named: "hush-wave-keyframe-03",
                    size: size
                )
                .modifier(
                    KeyframeRevealModifier(
                        opacity: plateOpacity(index: 2, progress: progress),
                        reveal: plateReveal(index: 2, progress: progress),
                        size: size
                    )
                )

                keyframePlate(
                    named: "hush-wave-keyframe-04",
                    size: size
                )
                .modifier(
                    KeyframeRevealModifier(
                        opacity: plateOpacity(index: 3, progress: progress),
                        reveal: plateReveal(index: 3, progress: progress),
                        size: size
                    )
                )
            }
            .frame(width: size.width, height: size.height)
            .clipped()
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }

    private func keyframePlate(
        named name: String,
        size: CGSize
    ) -> some View {
        bundledBitmap(named: name)
            .resizable()
            .interpolation(.high)
            .antialiased(true)
            .scaledToFill()
            .frame(width: size.width, height: size.height)
            .clipped()
    }

    private func plateOpacity(
        index: Int,
        progress: CGFloat
    ) -> CGFloat {
        let stops: [CGFloat] = [0, 0.36, 0.72, 1]

        if index == 0 {
            return 1 - smoothProgress(
                progress,
                from: stops[0],
                to: stops[1]
            )
        }

        if index == stops.count - 1 {
            return smoothProgress(
                progress,
                from: stops[index - 1],
                to: stops[index]
            )
        }

        if progress <= stops[index] {
            return smoothProgress(
                progress,
                from: stops[index - 1],
                to: stops[index]
            )
        }

        return 1 - smoothProgress(
            progress,
            from: stops[index],
            to: stops[index + 1]
        )
    }

    private func plateReveal(
        index: Int,
        progress: CGFloat
    ) -> CGFloat {
        let starts: [CGFloat] = [0, 0, 0.36, 0.72]
        let ends: [CGFloat] = [0, 0.36, 0.72, 1]
        guard index > 0 else { return 1 }
        return smoothProgress(
            progress,
            from: starts[index],
            to: ends[index]
        )
    }

    private func smoothProgress(
        _ value: CGFloat,
        from start: CGFloat,
        to end: CGFloat
    ) -> CGFloat {
        guard end > start else { return value >= end ? 1 : 0 }
        let normalized = min(1, max(0, (value - start) / (end - start)))
        return normalized * normalized * (3 - 2 * normalized)
    }

    private func idleKeyframePlate(
        size: CGSize,
        elapsed: TimeInterval
    ) -> some View {
        Canvas { context, canvasSize in
            let image = context.resolve(
                bundledBitmap(named: "hush-wave-keyframe-01")
            )
            // keyframe-01 is 1672 × 941; keep the original aspect and
            // aspect-fill with centered cropping.
            let destination = aspectFillRect(
                sourceAspect: CGFloat(1672) / CGFloat(941),
                in: canvasSize
            )

            let time = CGFloat(elapsed)
            // Ramp the motion in from a dead-exact first frame so Image 1
            // is initially rendered exactly as uploaded.
            let entrance = smoothProgress(time, from: 0, to: 1.1)

            // Seam-free vertical-column shear: the plate is sliced into thin
            // full-height vertical strips, and each strip is translated
            // vertically by a smooth, continuous displacement field. Because
            // every strip is an exact vertical slice of the original bitmap
            // and neighbouring strips differ by a sub-pixel amount, the broken
            // stroke texture is preserved and no tiling seams appear. The
            // field is a sum of standing waves (spatial × temporal products)
            // so the threads breathe in place rather than travelling across.
            let columnCount = min(
                240,
                max(80, Int(canvasSize.width / 4))
            )
            let columnWidth = canvasSize.width / CGFloat(columnCount)

            for column in 0..<columnCount {
                let normalizedX =
                    (CGFloat(column) + 0.5) / CGFloat(columnCount)

                // Calm at the left/right ends, most deformation near centre.
                let edge = pow(max(0, sin(normalizedX * .pi)), 1.6)

                // Standing waves — no left-to-right travelling motion.
                let breathA =
                    sin(normalizedX * 3.1 + 0.4)
                    * sin(time * (.pi * 2 / 9.0))
                let breathB =
                    sin(normalizedX * 5.7 + 1.7)
                    * sin(time * (.pi * 2 / 15.0) + 0.9)
                let breathC =
                    sin(normalizedX * 2.2 - 0.6)
                    * sin(time * (.pi * 2 / 12.5) + 2.1)

                // Tiny long-period drift so the loop never looks perfectly
                // repetitive.
                let slowVariation =
                    0.82 + 0.18 * sin(time * (.pi * 2 / 23.0))

                let verticalOffset =
                    (breathA * 2.8 + breathB * 1.4 + breathC * 1.8)
                    * edge
                    * slowVariation
                    * entrance

                let strip = CGRect(
                    x: CGFloat(column) * columnWidth,
                    y: 0,
                    width: columnWidth + 0.75,
                    height: canvasSize.height
                )

                context.drawLayer { layer in
                    layer.clip(to: Path(strip))
                    layer.draw(
                        image,
                        in: destination.offsetBy(
                            dx: 0,
                            dy: verticalOffset
                        )
                    )
                }
            }
        }
        .frame(width: size.width, height: size.height)
    }

    private func aspectFillRect(
        sourceAspect: CGFloat,
        in canvasSize: CGSize
    ) -> CGRect {
        let canvasAspect = canvasSize.width / max(1, canvasSize.height)

        if sourceAspect > canvasAspect {
            let width = canvasSize.height * sourceAspect
            return CGRect(
                x: (canvasSize.width - width) * 0.5,
                y: 0,
                width: width,
                height: canvasSize.height
            )
        } else {
            let height = canvasSize.width / sourceAspect
            return CGRect(
                x: 0,
                y: (canvasSize.height - height) * 0.5,
                width: canvasSize.width,
                height: height
            )
        }
    }

    private func bundledBitmap(named name: String) -> Image {
        guard let url = Bundle.main.url(
            forResource: name,
            withExtension: "png"
        ) else {
            return Image(systemName: "exclamationmark.triangle")
        }

        #if os(macOS)
        guard let bitmap = NSImage(contentsOf: url) else {
            return Image(systemName: "exclamationmark.triangle")
        }
        return Image(nsImage: bitmap)
        #else
        guard let bitmap = UIImage(contentsOfFile: url.path) else {
            return Image(systemName: "exclamationmark.triangle")
        }
        return Image(uiImage: bitmap)
        #endif
    }
}

private struct KeyframeRevealModifier: ViewModifier {
    let opacity: CGFloat
    let reveal: CGFloat
    let size: CGSize

    func body(content: Content) -> some View {
        let visibleHeight = size.height * min(1, 0.12 + reveal * 1.08)

        content
            .offset(y: size.height * 0.1 * (1 - reveal))
            .mask(alignment: .bottom) {
                Rectangle()
                    .frame(height: visibleHeight)
            }
            .opacity(opacity)
    }
}
