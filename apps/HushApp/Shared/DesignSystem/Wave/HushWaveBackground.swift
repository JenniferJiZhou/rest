import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

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

enum HushTideTimeline {
    static let tideDuration: TimeInterval = 4.3
    static let lineToFillEnd: CGFloat = 0.36
    static let pageRevealStart: CGFloat = 0.42
    static let pageRevealEnd: CGFloat = 0.99
    static let messageStart: TimeInterval = 2.2
    static let messageStagger: TimeInterval = 0.06
    static let messageRowDuration: TimeInterval = 0.5

    static func tideProgress(elapsed: TimeInterval) -> CGFloat {
        let u = clamp(CGFloat(elapsed / tideDuration), lower: 0, upper: 1)
        return cubicBezierEase(u, 0.12, 0.16, 0.62, 1.0)
    }

    static func cubicBezierEase(
        _ t: CGFloat,
        _ x1: CGFloat, _ y1: CGFloat,
        _ x2: CGFloat, _ y2: CGFloat
    ) -> CGFloat {
        let t = clamp(t, lower: 0, upper: 1)
        func axis(_ a: CGFloat, _ b: CGFloat, _ s: CGFloat) -> CGFloat {
            let m = 1 - s
            return 3 * m * m * s * a + 3 * m * s * s * b + s * s * s
        }
        func axisSlope(_ a: CGFloat, _ b: CGFloat, _ s: CGFloat) -> CGFloat {
            let m = 1 - s
            return 3 * m * m * a + 6 * m * s * (b - a) + 3 * s * s * (1 - b)
        }
        var s = t
        for _ in 0..<6 {
            let dx = axis(x1, x2, s) - t
            let slope = axisSlope(x1, x2, s)
            if abs(slope) < 1e-6 { break }
            s = clamp(s - dx / slope, lower: 0, upper: 1)
        }
        return axis(y1, y2, s)
    }

    static func pageFront(_ progress: CGFloat) -> CGFloat {
        smoothstep(progress, pageRevealStart, pageRevealEnd)
    }

    static func pageOpacity(_ progress: CGFloat) -> CGFloat {
        smoothstep(progress, 0.35, 0.9)
    }

    static func messageReveal(elapsed: TimeInterval, index: Int) -> CGFloat {
        let start = messageStart + Double(index) * messageStagger
        return smoothstep(
            CGFloat(elapsed),
            CGFloat(start),
            CGFloat(start + messageRowDuration)
        )
    }

    static func frontGradientStops(front: CGFloat, feather: CGFloat) -> [Gradient.Stop] {
        let t0 = clamp(front - feather, lower: 0, upper: 1)
        let t1 = clamp(front, lower: 0, upper: 1)
        return [
            Gradient.Stop(color: .black, location: 0),
            Gradient.Stop(color: .black, location: t0),
            Gradient.Stop(color: .clear, location: t1),
            Gradient.Stop(color: .clear, location: 1)
        ]
    }

    static func smoothstep(_ value: CGFloat, _ start: CGFloat, _ end: CGFloat) -> CGFloat {
        guard end > start else { return value >= end ? 1 : 0 }
        let t = clamp((value - start) / (end - start), lower: 0, upper: 1)
        return t * t * (3 - 2 * t)
    }

    static func clamp(_ value: CGFloat, lower: CGFloat, upper: CGFloat) -> CGFloat {
        min(upper, max(lower, value))
    }
}

struct HushTideReveal {
    var progress: CGFloat
    var elapsed: TimeInterval

    static let settled = HushTideReveal(progress: 1, elapsed: 1_000_000)
}

struct HushTidePageSurface: View {
    var progress: CGFloat

    var body: some View {
        let feather: CGFloat = 0.14
        let front = HushTideTimeline.pageFront(progress) * (1 + feather + 0.03)

        Rectangle()
            .fill(HushColor.ink)
            .opacity(Double(HushTideTimeline.pageOpacity(progress)))
            .mask(
                LinearGradient(
                    stops: HushTideTimeline.frontGradientStops(
                        front: front,
                        feather: feather
                    ),
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .ignoresSafeArea()
            .allowsHitTesting(false)
    }
}

struct HushTideMessageReveal: ViewModifier {
    let index: Int
    var elapsed: TimeInterval
    var reduceMotion: Bool

    func body(content: Content) -> some View {
        let reveal = HushTideTimeline.messageReveal(elapsed: elapsed, index: index)
        let hidden = 1 - reveal

        return content
            .opacity(Double(reveal))
            .blur(radius: reduceMotion ? 0 : Double(hidden * 6))
            .offset(y: reduceMotion ? 0 : hidden * 10)
            .allowsHitTesting(reveal >= 0.999)
            .accessibilityHidden(reveal < 0.5)
    }
}

extension View {
    func hushTideReveal(
        index: Int,
        elapsed: TimeInterval,
        reduceMotion: Bool
    ) -> some View {
        modifier(
            HushTideMessageReveal(
                index: index,
                elapsed: elapsed,
                reduceMotion: reduceMotion
            )
        )
    }
}

struct HushCompanionBackground: View, Animatable {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var idleStartedAt = Date()

    var exitProgress: CGFloat = 0
    var readingLower: CGFloat = 0

    var animatableData: CGFloat {
        get { exitProgress }
        set { exitProgress = newValue }
    }

    private let idleRaise: CGFloat = 0.25
    private let breathScale: Double = 1.85
    private static let idlePlateSize = CGSize(width: 941, height: 1672)

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            let progress = min(1, max(0, exitProgress))

            ZStack {
                Color.black
                idleLines(size: size, progress: progress)
                foamRetreat(size: size, progress: progress)
            }
            .frame(width: size.width, height: size.height)
            .clipped()
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private func idleLines(size: CGSize, progress: CGFloat) -> some View {
        let visible = 1 - HushTideTimeline.smoothstep(progress, 0, 0.30)
        let lower = min(1, max(0, readingLower))

        if visible > 0.001 {
            let lift = size.height * 0.05
                * HushTideTimeline.smoothstep(progress, 0, 0.24)
            let calm = (1 - 0.6 * HushTideTimeline.smoothstep(progress, 0, 0.22))
                * (1 - 0.55 * lower)
            let readingDrop = lower * size.height * 0.30
            let readingDim = 1 - 0.5 * lower

            TimelineView(
                .animation(minimumInterval: 1.0 / 60.0, paused: reduceMotion)
            ) { timeline in
                let elapsed = reduceMotion
                    ? 0
                    : timeline.date.timeIntervalSince(idleStartedAt) * breathScale

                companionLinePlate(
                    size: size,
                    elapsed: elapsed,
                    amplitudeScale: calm
                )
                .offset(y: -size.height * idleRaise - lift + readingDrop)
                .opacity(Double(visible * readingDim))
            }
        }
    }

    @ViewBuilder
    private func companionLinePlate(
        size: CGSize,
        elapsed: TimeInterval,
        amplitudeScale: CGFloat
    ) -> some View {
        let amplitude = reduceMotion
            ? 0
            : HushTideTimeline.smoothstep(CGFloat(elapsed), 0, 1.2) * amplitudeScale
        let source = Self.idlePlateSize
        let scale = fillScale(for: size, source: source)
        let plate = CGSize(width: source.width * scale, height: source.height * scale)

        let base = companionImage(named: "hush-companion-idle")
            .resizable()
            .interpolation(.high)
            .antialiased(true)
            .frame(width: plate.width, height: plate.height)

        if amplitude <= 0 {
            base
        } else {
            base.distortionEffect(
                ShaderLibrary.hushLineFloat(
                    .float(Float(elapsed)),
                    .float2(Float(plate.width), Float(plate.height)),
                    .float(Float(amplitude))
                ),
                maxSampleOffset: CGSize(width: 2, height: plate.height * 0.14)
            )
        }
    }

    @ViewBuilder
    private func foamRetreat(size: CGSize, progress: CGFloat) -> some View {
        if progress > 0.001 {
            let blendAB = HushTideTimeline.smoothstep(progress, 0.18, 0.52)
            let blendBC = HushTideTimeline.smoothstep(progress, 0.44, 0.78)
            let reveal = HushTideTimeline.smoothstep(progress, 0.01, 0.30)
            let retreat = HushTideTimeline.smoothstep(progress, 0.66, 1)
            let motion = reduceMotion ? 0 : sin(.pi * progress)
            let time = progress * 7.5

            ZStack {
                renderedFoamPlate(
                    named: "hush-companion-ocean-a",
                    size: size,
                    time: time,
                    motion: motion,
                    phase: 0.2
                )
                .opacity(Double(1 - blendAB))

                renderedFoamPlate(
                    named: "hush-companion-ocean-b",
                    size: size,
                    time: time,
                    motion: motion,
                    phase: 1.7
                )
                .opacity(Double(blendAB * (1 - blendBC)))

                renderedFoamPlate(
                    named: "hush-companion-ocean-c",
                    size: size,
                    time: time,
                    motion: motion,
                    phase: 3.1
                )
                .opacity(Double(blendBC))
            }
            .compositingGroup()
            .colorEffect(
                ShaderLibrary.hushFoamErode(
                    .float2(Float(size.width), Float(size.height)),
                    .float(Float(reveal)),
                    .float(Float(retreat)),
                    .float(Float(time))
                )
            )
        }
    }

    private func renderedFoamPlate(
        named name: String,
        size: CGSize,
        time: CGFloat,
        motion: CGFloat,
        phase: CGFloat
    ) -> some View {
        companionImage(named: name)
            .resizable()
            .interpolation(.high)
            .antialiased(true)
            .aspectRatio(contentMode: .fill)
            .frame(width: size.width, height: size.height)
            .clipped()
            .distortionEffect(
                ShaderLibrary.hushFoamFlow(
                    .float(Float(time)),
                    .float2(Float(size.width), Float(size.height)),
                    .float(Float(motion)),
                    .float(Float(phase))
                ),
                maxSampleOffset: CGSize(
                    width: size.width * 0.025,
                    height: size.height * 0.025
                )
            )
    }

    private func fillScale(for viewSize: CGSize, source: CGSize) -> CGFloat {
        max(viewSize.width / source.width, viewSize.height / source.height)
    }

    @MainActor private static var imageCache: [String: Image] = [:]

    private func companionImage(named name: String) -> Image {
        if let cached = Self.imageCache[name] { return cached }

        let image: Image
        if let url = Bundle.main.url(forResource: name, withExtension: "png") {
            #if os(macOS)
            image = NSImage(contentsOf: url).map(Image.init(nsImage:))
                ?? Image(systemName: "exclamationmark.triangle")
            #else
            image = UIImage(contentsOfFile: url.path).map(Image.init(uiImage:))
                ?? Image(systemName: "exclamationmark.triangle")
            #endif
        } else {
            image = Image(systemName: "exclamationmark.triangle")
        }

        Self.imageCache[name] = image
        return image
    }
}
