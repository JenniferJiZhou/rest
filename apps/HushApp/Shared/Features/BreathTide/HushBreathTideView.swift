import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// One breath, described once so the view and the debug probe agree on it.
///
/// Inhale is carried by the tide rising, the held breath by the water standing
/// full and turning to foam, and the exhale by that foam dissolving away from
/// the top until the screen is black. The picture is the instruction — there is
/// no counter chasing the user, and the screen can be ignored entirely.
enum HushBreathPhase {
    case inhale
    case hold
    case exhale
}

enum HushBreathCycle {
    static let inhale: Double = 4.0
    static let hold: Double = 4.0
    /// Longer and slower than the inhale, per the breathing pattern. The foam
    /// dissolve and the fall to black both live inside this phase.
    static let exhale: Double = 5.5
    static let total: Double = inhale + hold + exhale   // 13.5 s

    static func phase(at t: Double) -> (phase: HushBreathPhase, progress: Double) {
        let x = t.truncatingRemainder(dividingBy: total)
        if x < inhale { return (.inhale, x / inhale) }
        if x < inhale + hold { return (.hold, (x - inhale) / hold) }
        return (.exhale, (x - inhale - hold) / exhale)
    }

    static func smoothstep(_ v: Double, _ a: Double, _ b: Double) -> Double {
        guard b > a else { return v >= b ? 1 : 0 }
        let t = min(1, max(0, (v - a) / (b - a)))
        return t * t * (3 - 2 * t)
    }

    // MARK: - Phase → picture
    //
    // One definition of the look, read by both the live session and the debug
    // probe, so a frame captured for review is the frame that ships.

    /// Tide height through the inhale: eased in, steady through the middle,
    /// settling as it reaches full. Mixing a linear ramp into the smoothstep
    /// keeps the middle from sagging, and nothing here overshoots — there is no
    /// spring anywhere in the rise.
    static func tideReveal(_ s: (phase: HushBreathPhase, progress: Double)) -> CGFloat {
        guard case .inhale = s.phase else { return 1 }
        let p = min(1, max(0, s.progress))
        let eased = smoothstep(p, 0, 1)
        return CGFloat(0.42 * p + 0.58 * eased)
    }

    /// The water fades out only as the foam comes up under it, so the surface is
    /// never bare and the change of material reads as one continuous picture.
    static func waterOpacity(_ s: (phase: HushBreathPhase, progress: Double)) -> Double {
        switch s.phase {
        case .inhale: return 1
        case .hold:   return 1 - smoothstep(s.progress, 0.30, 0.96)
        case .exhale: return 0
        }
    }

    /// Foam surfaces under the dimming water, and is fully covering the screen
    /// before the exhale begins to take it away.
    static func foamOpacity(_ s: (phase: HushBreathPhase, progress: Double)) -> Double {
        switch s.phase {
        case .inhale: return 0
        case .hold:   return smoothstep(s.progress, 0.24, 0.92)
        case .exhale: return 1
        }
    }

    /// How far the dissolve has swept down the screen.
    ///
    /// Deliberately close to linear, with only a soft start and finish. A
    /// strongly decelerating curve was tried first and measured wrong: the
    /// screen was already black 62% into the exhale, leaving two dead seconds
    /// on the end of the breath. Near-linear keeps the foam retreating for the
    /// whole phase and reaches black exactly at the end; the sense of slowing
    /// comes from `surfaceDrift`, which quiets the foam's own movement as the
    /// exhale runs out.
    static func erosionFront(_ s: (phase: HushBreathPhase, progress: Double)) -> Double {
        guard case .exhale = s.phase else { return 0 }
        let p = min(1, max(0, s.progress))
        return 0.55 * p + 0.45 * smoothstep(p, 0, 1)
    }

    /// Amplitude of the fluid wobble. It thins out across the hold so the
    /// surface visibly settles, and again across the exhale so the last of the
    /// foam is almost still.
    static func surfaceDrift(_ s: (phase: HushBreathPhase, progress: Double)) -> Double {
        switch s.phase {
        case .inhale:
            return 0.004
        case .hold:
            return 0.010 * (1 - 0.72 * smoothstep(s.progress, 0, 1))
        case .exhale:
            return 0.007 * (1 - 0.80 * smoothstep(s.progress, 0, 1))
        }
    }

    /// The single word, tied to the held breath only.
    static func holdLabelOpacity(_ s: (phase: HushBreathPhase, progress: Double)) -> Double {
        guard case .hold = s.phase else { return 0 }
        return smoothstep(s.progress, 0.20, 0.42) * (1 - smoothstep(s.progress, 0.82, 0.98))
    }

    /// Density of each foam plate. Wide, overlapping and slowly varying — the
    /// three plates are materials layered together, never frames cut between.
    static func foamDensities(time: Double) -> (bTop: Double, bBottom: Double, c: Double, a: Double) {
        (
            bTop: 0.90 + 0.10 * sin(time * 0.21),
            bBottom: 0.92 + 0.08 * sin(time * 0.17 + 1.1),
            c: 0.34 + 0.16 * sin(time * 0.13 + 2.3),
            a: 0.30 + 0.16 * sin(time * 0.11 + 0.7)
        )
    }
}

/// Decode each plate once. The session redraws at 60 fps and these are 1–2 MB
/// PNGs, so re-reading them per frame would stutter. Main-actor only, which is
/// where SwiftUI renders, so a plain dictionary is safe.
@MainActor
enum HushBreathPlates {
    private static var cache: [String: Image] = [:]

    static func image(_ name: String) -> Image {
        if let hit = cache[name] { return hit }
        let made: Image
        if let url = Bundle.main.url(forResource: name, withExtension: "png") {
            #if os(macOS)
            made = NSImage(contentsOf: url).map(Image.init(nsImage:))
                ?? Image(systemName: "exclamationmark.triangle")
            #else
            made = UIImage(contentsOfFile: url.path).map(Image.init(uiImage:))
                ?? Image(systemName: "exclamationmark.triangle")
            #endif
        } else {
            made = Image(systemName: "exclamationmark.triangle")
        }
        cache[name] = made
        return made
    }
}

/// The guided breathing session.
///
/// The rising water is the Hush Door's own tide — `HushWaveBackground` driven
/// through its reveal — so the breath begins in the picture the door was
/// already showing. The foam is built from the companion's three plates, used
/// as materials rather than as frames.
struct HushBreathTideView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// How long the session runs before it finishes on its own.
    var duration: Double = 180
    var onFinish: () -> Void

    @State private var startedAt = Date()
    @State private var isLeaving = false

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size

            TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: false)) { timeline in
                let elapsed = timeline.date.timeIntervalSince(startedAt)
                let step = HushBreathCycle.phase(at: elapsed)

                HushBreathStage(
                    step: step,
                    time: elapsed,
                    size: size,
                    reduceMotion: reduceMotion
                )
                .overlay { exitAffordance(size: size) }
                .onChange(of: Int(elapsed)) { _, _ in
                    // Only ever end on a completed breath, so the session never
                    // cuts off mid-inhale.
                    guard !isLeaving, elapsed >= duration else { return }
                    let intoBreath = elapsed.truncatingRemainder(
                        dividingBy: HushBreathCycle.total
                    )
                    if intoBreath >= HushBreathCycle.total - 0.25 { finish() }
                }
            }
        }
        .ignoresSafeArea()
        .contentShape(Rectangle())
        .onTapGesture { finish() }
        .preferredColorScheme(.dark)
        .accessibilityElement()
        .accessibilityLabel("跟随潮水呼吸")
        .accessibilityHint("轻点结束")
    }

    private func exitAffordance(size: CGSize) -> some View {
        VStack {
            Spacer()
            Text("轻点结束")
                .font(HushType.micro)
                .tracking(0.6)
                .foregroundStyle(Color.white.opacity(0.34))
                .padding(.bottom, HushSpacing.xl)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func finish() {
        guard !isLeaving else { return }
        isLeaving = true
        onFinish()
    }
}

/// The picture for one instant of the breath. Split out so the debug probe can
/// render an exact moment through the same code the session runs.
struct HushBreathStage: View {
    let step: (phase: HushBreathPhase, progress: Double)
    let time: Double
    let size: CGSize
    var reduceMotion: Bool = false

    var body: some View {
        let drift = reduceMotion ? 0 : HushBreathCycle.surfaceDrift(step)
        let front = HushBreathCycle.erosionFront(step)
        let motionTime = reduceMotion ? 0 : time

        ZStack {
            Color.black

            // The door's own tide, reused rather than re-implemented.
            HushWaveBackground(revealProgress: HushBreathCycle.tideReveal(step))
                .opacity(HushBreathCycle.waterOpacity(step))

            foamMaterial
                .opacity(HushBreathCycle.foamOpacity(step))
                .compositingGroup()
                // Dissolve, not displacement: the plate never moves: its alpha
                // is eaten away from the top by a noisy contour.
                .layerEffect(
                    ShaderLibrary.hushFoamVeil(
                        .float2(Float(size.width), Float(size.height)),
                        .float(Float(front)),
                        .float(Float(drift)),
                        .float(Float(motionTime))
                    ),
                    maxSampleOffset: CGSize(
                        width: size.height * 0.02,
                        height: size.height * 0.02
                    )
                )

            Text("hold")
                .font(.system(size: 15, weight: .regular))
                .tracking(3.4)
                .foregroundStyle(Color.white.opacity(0.82))
                .opacity(HushBreathCycle.holdLabelOpacity(step))
                .accessibilityHidden(true)
        }
        .frame(width: size.width, height: size.height)
        .clipped()
    }

    /// Full-screen foam built from the three companion plates.
    ///
    /// None of them covers the whole screen on its own — b holds the lower two
    /// thirds, c a band at the top, a a band at the bottom — so b is also drawn
    /// mirrored to fill the top. They are combined with `.lighten` so each
    /// plate's black region cannot occlude the foam in the plate beneath, and
    /// their densities drift slowly and independently, which is what keeps this
    /// a blend of materials rather than a sequence of frames.
    private var foamMaterial: some View {
        let density = HushBreathCycle.foamDensities(
            time: reduceMotion ? 0 : time
        )

        return ZStack {
            plate("hush-companion-ocean-b")
                .scaleEffect(y: -1)
                .opacity(density.bTop)

            plate("hush-companion-ocean-b")
                .opacity(density.bBottom)
                .blendMode(.lighten)

            plate("hush-companion-ocean-c")
                .opacity(density.c)
                .blendMode(.lighten)

            plate("hush-companion-ocean-a")
                .opacity(density.a)
                .blendMode(.lighten)
        }
    }

    private func plate(_ name: String) -> some View {
        HushBreathPlates.image(name)
            .resizable()
            .interpolation(.high)
            .antialiased(true)
            .aspectRatio(contentMode: .fill)
            .frame(width: size.width, height: size.height)
            .clipped()
    }
}

/// The invitation shown before the session starts. Entering is always the
/// user's choice — the tide is offered, never imposed.
struct HushBreathInviteView: View {
    var onAccept: () -> Void
    var onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: HushSpacing.lg) {
            Text("随潮水一起呼吸吧")
                .font(HushType.agentTask)
                .tracking(0.8)
                .foregroundStyle(Color.white.opacity(0.94))
                .fixedSize(horizontal: false, vertical: true)

            Text("水涨时吸气，停住时屏息，退潮时呼气。\n不用一直看着屏幕，跟着感觉就好。")
                .font(HushType.body)
                .foregroundStyle(HushColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: HushSpacing.sm) {
                Button(action: onAccept) {
                    Text("开始")
                        .font(HushType.body)
                        .foregroundStyle(Color.black.opacity(0.86))
                        .padding(.horizontal, HushSpacing.lg)
                        .padding(.vertical, HushSpacing.sm)
                        .background(Capsule().fill(Color.white.opacity(0.9)))
                }
                .buttonStyle(.plain)

                Button(action: onDismiss) {
                    Text("再等等")
                        .font(HushType.body)
                        .foregroundStyle(HushColor.textSecondary)
                        .padding(.horizontal, HushSpacing.md)
                        .padding(.vertical, HushSpacing.sm)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(HushSpacing.xl)
        .frame(maxWidth: 340, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                // Opaque on purpose: the door's task text sits directly behind
                // this card, and even a few percent of transparency lets it
                // read through the buttons. A hair off pure black so the panel
                // still separates from the door behind it.
                .fill(Color(white: 0.045))
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .stroke(HushColor.hairline, lineWidth: 0.8)
                )
        )
    }
}

#if DEBUG
/// Renders the session at a controlled instant so a whole breath can be checked
/// frame by frame. It drives `HushBreathStage` — the same view the session uses
/// — so a reviewed frame is a shipped frame.
struct HushBreathTideProbe: View {
    let elapsed: Double
    var reduceMotion: Bool = false

    var body: some View {
        GeometryReader { geo in
            HushBreathStage(
                step: HushBreathCycle.phase(at: elapsed),
                time: elapsed,
                size: geo.size,
                reduceMotion: reduceMotion
            )
        }
    }
}
#endif
