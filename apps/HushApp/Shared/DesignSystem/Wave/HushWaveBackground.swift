import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Measured motion model between the raster plates.
///
/// The offsets below are not hand-tuned: they were produced by masked
/// normalised cross-correlation between the original bitmaps at their native
/// 1586 × 992, sampling only ocean pixels so keyframe-02's black sky could not
/// dominate the score.
///
///   identity (0, 0)          NCC = -0.086   ← plates do not correspond in place
///   best     (190, 343)      NCC =  0.736   ← real structural correspondence
///   control: 02 vs itself shifted by 343 → NCC = -0.008
///
/// The control run matters: because the plate does *not* self-correlate at that
/// shift, the 0.736 is genuine correspondence rather than an artefact of the
/// repeating watercolour texture. In other words the dominant motion carrying
/// keyframe-02 into keyframe-03 is a translation of (-190, -343) source pixels
/// — the ocean rises and drifts slightly left.
///
/// Registering the plates by this vector *before* handing over means the same
/// wave features sit on top of each other during the handover, so the crossover
/// cannot ghost or double-image. This is motion-compensated interpolation with
/// a measured global-translation model, and unlike a learned frame
/// interpolator it never synthesises a pixel that the artist did not draw.
private enum HushWaveMotion {
    /// Native pixel size of the ocean plates (keyframes 02–04).
    static let sourceSize = CGSize(width: 1586, height: 992)

    /// The line plate was authored at a different aspect ratio, so it needs its
    /// own dimensions — filling it into the ocean plates' box would stretch it.
    static let linePlateSourceSize = CGSize(width: 1672, height: 941)

    static func sourceSize(for name: String) -> CGSize {
        name.hasSuffix("keyframe-01") ? linePlateSourceSize : sourceSize
    }

    /// Motion of the artwork content from keyframe-02 to keyframe-03,
    /// in source pixels.
    static let plate02To03 = CGSize(width: -190, height: -343)

    /// Aspect-fill scale for a plate of `source` shown in `viewSize`.
    static func fillScale(
        for viewSize: CGSize,
        source: CGSize = sourceSize
    ) -> CGFloat {
        max(
            viewSize.width / source.width,
            viewSize.height / source.height
        )
    }
}

struct HushWaveBackground: View, Animatable {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var idleStartedAt = Date()

    var revealProgress: CGFloat = 0

    var animatableData: CGFloat {
        get { revealProgress }
        set { revealProgress = newValue }
    }

    /// The four locked stops. At each of these the corresponding plate is the
    /// only thing on screen, at zero displacement, so the frame is the exact
    /// original bitmap.
    private static let stops: [CGFloat] = [0, 0.36, 0.72, 1]

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            let progress = min(1, max(0, revealProgress))

            // The line keeps its own lull for as long as any of it is still
            // above water — right through the start of the swipe — so it never
            // freezes the instant the finger moves and then jump-cuts to a
            // still. It is only allowed to pause once the flood has fully
            // consumed it (progress ≥ the second stop).
            let lineVisible = progress < Self.stops[1]
            let animateLine = !reduceMotion && lineVisible

            ZStack {
                Color.black

                // The lulling line stays live in the back. It is NOT masked away
                // on a straight edge — the colour that blooms out of it (plate
                // 02) rises in front and simply draws over it, so the line is
                // absorbed by the water it becomes. Same idle clock throughout:
                // no freeze, no phase reset at the trigger.
                if lineVisible {
                    TimelineView(
                        .animation(
                            minimumInterval: 1.0 / 60.0,
                            paused: !animateLine
                        )
                    ) { timeline in
                        let elapsed = animateLine
                            ? timeline.date.timeIntervalSince(idleStartedAt)
                            : 0

                        linePlate(size: size, elapsed: elapsed)
                    }
                }

                // Plate 02 is the colour that grows out of the line: it is
                // revealed by a bloom whose leading edge IS the line's current
                // curve (reconstructed from the same profile, on the same clock),
                // thickening downward into a water body before the whole thing
                // rises. See `colorFormationPlate`.
                colorFormationPlate(size: size, progress: progress)

                oceanPlate(
                    named: "hush-wave-keyframe-03",
                    index: 2,
                    size: size,
                    progress: progress
                )

                oceanPlate(
                    named: "hush-wave-keyframe-04",
                    index: 3,
                    size: size,
                    progress: progress
                )
            }
            .frame(width: size.width, height: size.height)
            .clipped()
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }

    // MARK: - Line plate (keyframe-01)

    /// The line plate is warped by a displacement field rather than redrawn.
    /// The shader only chooses where to *sample* the original bitmap, so the
    /// broken dry-brush edges travel with their own pixels. `amplitude` ramps
    /// in from zero, so the first frame — and every Reduce Motion frame — is
    /// the identity mapping and therefore pixel-exact.
    @ViewBuilder
    private func linePlate(
        size: CGSize,
        elapsed: TimeInterval
    ) -> some View {
        let amplitude: CGFloat = reduceMotion
            ? 0
            : smoothstep(CGFloat(elapsed), from: 0, to: 1.4)

        if amplitude <= 0 {
            // Bypass the shader entirely rather than running an identity warp:
            // even a no-op distortion pass costs a resample, and this is the
            // frame that has to be the untouched original.
            keyframePlate(named: "hush-wave-keyframe-01", size: size)
        } else {
            // The shader works in the PLATE's coordinate space, not the view's.
            // The measured profile is indexed by the artwork's own x, so it
            // would land on the wrong humps if the view size were passed here.
            let source = HushWaveMotion.linePlateSourceSize
            let scale = HushWaveMotion.fillScale(for: size, source: source)
            let plate = CGSize(
                width: source.width * scale,
                height: source.height * scale
            )

            keyframePlate(named: "hush-wave-keyframe-01", size: size)
                .distortionEffect(
                    ShaderLibrary.hushThreadDrift(
                        .float(Float(elapsed)),
                        .float2(Float(plate.width), Float(plate.height)),
                        .float(Float(amplitude))
                    ),
                    // Peak-to-trough inversion needs a large sampling reach:
                    // 0.173 of plate height for the morph plus 0.082 for the
                    // tension term.
                    maxSampleOffset: CGSize(
                        width: 2,
                        height: plate.height * 0.28
                    )
                )
        }
    }

    /// Plate 02 — the colour the lines become — grown out of the line rather
    /// than wiped in on a straight edge.
    ///
    /// `fill` is the same 0→1 ramp the first waterline used, but instead of a
    /// horizontal reveal it drives `HushTideBloomMask`, whose leading edge is
    /// the line's *current* curve (same profile, same idle clock, so its peaks
    /// and motion match what is on screen at the trigger). The mask starts as a
    /// thin ribbon hugging that curve, thickens downward into a water body, then
    /// the whole front rises and straightens — the line inheriting colour, mass
    /// and finally lift. The plate keeps its motion-compensated rise so it hands
    /// over to plate 03 in registration exactly as before.
    @ViewBuilder
    private func colorFormationPlate(
        size: CGSize,
        progress: CGFloat
    ) -> some View {
        let scale = HushWaveMotion.fillScale(for: size)
        let steps = travelSteps(progress: progress)
            - travelSteps(progress: Self.stops[1])
        let overflowX = max(
            0,
            (HushWaveMotion.sourceSize.width * scale - size.width) / 2
        )
        let driftX = -min(
            abs(HushWaveMotion.plate02To03.width * scale),
            overflowX
        )
        let offsetX = driftX * steps
        let offsetY = HushWaveMotion.plate02To03.height * scale * steps

        let fill = min(1, max(0, linearRamp(
            progress,
            from: Self.stops[0],
            to: Self.stops[1]
        )))

        if fill <= 0.0001 {
            // Idle: no colour at all, the line has the screen to itself.
            EmptyView()
        } else if fill >= 0.9999 {
            // Fully formed: composites directly and keeps rising toward plate 03.
            keyframePlate(named: "hush-wave-keyframe-02", size: size)
                .offset(x: offsetX, y: offsetY)
        } else {
            TimelineView(
                .animation(minimumInterval: 1.0 / 60.0, paused: reduceMotion)
            ) { timeline in
                let elapsed = reduceMotion
                    ? 0
                    : timeline.date.timeIntervalSince(idleStartedAt)

                keyframePlate(named: "hush-wave-keyframe-02", size: size)
                    .offset(x: offsetX, y: offsetY)
                    .frame(width: size.width, height: size.height)
                    .mask(
                        HushTideBloomMask(
                            elapsed: elapsed,
                            progress: progress,
                            size: size
                        )
                    )
            }
        }
    }

    // MARK: - Ocean plates (keyframes 02 – 04)

    /// Position along the shared travel path, measured in registration steps.
    ///
    /// Every ocean plate rides this one path, so at any instant consecutive
    /// plates are exactly one measured registration step apart and their wave
    /// features sit on top of each other. Plate *n* is at zero displacement
    /// when `travelSteps == n - 1`, which is precisely its locked stop.
    ///
    /// The mapping is deliberately linear in progress: a smoothstep here would
    /// flatten to zero velocity at every stop, and because this transition is
    /// driven by the user's finger that reads as the picture sticking at each
    /// keyframe while the finger keeps moving — the stop-motion feel we are
    /// removing. Linear travel means equal finger distance always buys equal
    /// picture movement.
    private func travelSteps(progress: CGFloat) -> CGFloat {
        let span = Self.stops[2] - Self.stops[1]
        guard span > 0 else { return 0 }
        return (progress - Self.stops[1]) / span
    }

    /// Each ocean plate physically travels along the shared path above: it
    /// rises into place, rests exactly on its own stop, then keeps rising as
    /// the next plate takes over from below.
    ///
    /// There is no opacity cross-dissolve between plates. The handover is done
    /// purely by an advancing waterline mask, and because the plates are held
    /// in registration the artwork either side of that waterline is the same
    /// ocean — so the edge reads as a wave front sweeping up the screen rather
    /// than one still image fading into another. The soft band on the mask is
    /// blending *aligned* content, which is why it cannot ghost or double.
    @ViewBuilder
    private func oceanPlate(
        named name: String,
        index: Int,
        size: CGSize,
        progress: CGFloat
    ) -> some View {
        let scale = HushWaveMotion.fillScale(for: size)

        // Anchor each plate to where its own stop falls on the shared path, so
        // its displacement is exactly zero at that stop and the frame is the
        // untouched original — while every plate still rides the one
        // continuous, constant-speed motion field.
        let steps = travelSteps(progress: progress)
            - travelSteps(progress: Self.stops[index])

        // Sideways drift is capped at the aspect-fill overflow actually
        // available in this window, so the plate can never slide far enough
        // to expose bare canvas at the edge. In a tall window the overflow is
        // nil and the motion becomes purely vertical, which is the dominant
        // component anyway.
        let overflowX = max(
            0,
            (HushWaveMotion.sourceSize.width * scale - size.width) / 2
        )
        let driftX = -min(
            abs(HushWaveMotion.plate02To03.width * scale),
            overflowX
        )

        let offsetX = driftX * steps
        let offsetY = HushWaveMotion.plate02To03.height * scale * steps

        // Linear rather than eased: the incoming plate's waterline has to climb
        // at least as fast as the outgoing plate rises, otherwise the strip the
        // outgoing plate vacates at the bottom is briefly uncovered. Linear
        // also keeps the picture moving at a constant rate under the finger.
        let waterline = min(1, max(0, linearRamp(
            progress,
            from: Self.stops[index - 1],
            to: Self.stops[index]
        )))

        if waterline >= 0.9999 {
            // Fully claimed: drop the mask so the plate composites directly.
            // At a locked stop this is what makes the frame bit-for-bit the
            // original rather than a masked copy of it.
            keyframePlate(named: name, size: size)
                .offset(x: offsetX, y: offsetY)
        } else if waterline > 0.0001 {
            keyframePlate(named: name, size: size)
                .offset(x: offsetX, y: offsetY)
                .mask {
                    waterlineMask(waterline: waterline, height: size.height)
                }
        }
    }

    /// Soft-edged reveal mask. Opaque behind the waterline, with a short
    /// feathered band at the front so the advancing edge reads as a wave front
    /// rather than a ruled horizontal line.
    ///
    /// The band travels a full band-height beyond each end of the screen, so at
    /// `waterline == 0` the mask is entirely clear (no sliver of ocean peeking
    /// along the bottom edge) and at `waterline == 1` it is entirely opaque
    /// (no residual feathering over the exact keyframe).
    private func waterlineMask(
        waterline: CGFloat,
        height: CGFloat
    ) -> some View {
        let band = max(1, height * 0.07)
        let advance = waterline * (height + band)

        return VStack(spacing: 0) {
            LinearGradient(
                colors: [.clear, .black],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: band)

            Rectangle().fill(Color.black)
        }
        .frame(height: height + band, alignment: .top)
        .offset(y: height - advance)
    }

    // MARK: - Plate rendering

    /// Aspect-fill at exactly the view's fill scale, deliberately *not* clipped
    /// here. Clipping a plate to the view before it is offset would throw away
    /// the aspect-fill overflow and leave bare black wherever the plate then
    /// travelled; the surrounding ZStack does the screen-edge clipping instead.
    private func keyframePlate(
        named name: String,
        size: CGSize
    ) -> some View {
        let source = HushWaveMotion.sourceSize(for: name)
        let scale = HushWaveMotion.fillScale(for: size, source: source)

        return bundledBitmap(named: name)
            .resizable()
            .interpolation(.high)
            .antialiased(true)
            .frame(
                width: source.width * scale,
                height: source.height * scale
            )
    }

    private func linearRamp(
        _ value: CGFloat,
        from start: CGFloat,
        to end: CGFloat
    ) -> CGFloat {
        guard end > start else { return value >= end ? 1 : 0 }
        return (value - start) / (end - start)
    }

    /// Smoothstep — C1 continuous, zero derivative at both ends, so every
    /// ramp eases in and out with no velocity jump at a stop.
    private func smoothstep(
        _ value: CGFloat,
        from start: CGFloat,
        to end: CGFloat
    ) -> CGFloat {
        guard end > start else { return value >= end ? 1 : 0 }
        let t = min(1, max(0, (value - start) / (end - start)))
        return t * t * (3 - 2 * t)
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

/// A Swift reconstruction of the line plate's own wave, so the colour can be
/// grown along the *actual* curve on screen at the trigger — not a preset shape.
///
/// These are the exact constants and formulas the `hushThreadDrift` Metal shader
/// warps the line bitmap with (`HUSH_PROFILE` is the measured brightest-pixel
/// row of keyframe-01, i.e. the drawn line's shape). Evaluating them here on the
/// same clock reproduces where every peak and trough is *right now* and which
/// way it is moving, so the bloom's leading edge inherits the line's shape and
/// velocity continuously instead of jumping to another set of waves.
enum HushLineProfile {
    static let halfAmp: CGFloat = 0.1154
    private static let tau: CGFloat = 6.28318530718

    /// Measured line profile (mean-removed, normalised to [-1, 1]).
    private static let profile: [CGFloat] = [
         0.4335,  0.3433,  0.1075, -0.2614, -0.6332, -0.7101, -0.2774,  0.1374,
         0.2561,  0.1407,  0.0512,  0.1349,  0.2960,  0.2785, -0.1796, -0.7780,
        -0.9986, -0.8040, -0.3439,  0.1672,  0.5086,  0.6163,  0.4511,  0.0693,
        -0.0657,  0.0899,  0.3617,  0.4662,  0.3414,  0.0550, -0.0281,  0.0309
    ]

    private static func sample(_ xNorm: CGFloat) -> CGFloat {
        let f = min(max(xNorm, 0), 1) * 31
        let i = Int(f.rounded(.down))
        var g = f - CGFloat(i)
        g = g * g * (3 - 2 * g)
        let a = min(max(i, 0), 31)
        let b = min(max(i + 1, 0), 31)
        return profile[a] + (profile[b] - profile[a]) * g
    }

    private static func tension(_ x: CGFloat, _ t: CGFloat, _ lane: CGFloat) -> CGFloat {
        var s: CGFloat = 0
        s += sin(3 * .pi * x + 0.7) * cos(t * (tau / 11) + lane * 0.9) * 0.34
        s += sin(4 * .pi * x - 1.2) * cos(t * (tau / 17) + 1.7 + lane * 0.6) * 0.26
        s += sin(6 * .pi * x + 2.3) * cos(t * (tau / 23) + 0.4 - lane * 0.5) * 0.15
        return s
    }

    /// The line's vertical deviation from its mean at column `xNorm` and time
    /// `t`, as a fraction of plate height, POSITIVE = higher on screen. This is
    /// the drawn shape (`profile`) carried by the same inversion `s` and tension
    /// the shader uses, so it tracks the on-screen curve frame-for-frame.
    static func deviation(_ xNorm: CGFloat, t: CGFloat, lane: CGFloat = 0.5) -> CGFloat {
        let x = min(max(xNorm, 0), 1)
        let s = 0.25 + 0.75 * cos(t * (tau / 17) + x * 5.5 + lane * 0.5)
        return halfAmp * (sample(x) * s + tension(x, t, lane) * 0.95)
    }
}

/// Grows plate 02 out of the line instead of wiping it in.
///
/// The mask is a filled ribbon between two copies of the line's current curve:
/// a small bloom above it and a downward-thickening water body below. Early on
/// it is a thin wavy sliver sitting on the line (colour seeping from the
/// strokes); as `progress` advances the body thickens, then the whole curve
/// rises and its waviness relaxes — the line gaining colour, then mass, then
/// lift, with its peaks staying put through the hand-off. Masking the real
/// watercolour plate keeps the hand-drawn texture; only the *edge* is procedural.
struct HushTideBloomMask: View {
    var elapsed: TimeInterval
    var progress: CGFloat
    var size: CGSize

    // The line band sits low-centre on screen; the colour blooms from there.
    // Peaks come from the profile, so these only set height/heft, not shape.
    private let lineBaseline: CGFloat = 0.62
    private let waveGain: CGFloat = 0.34
    private let waveSign: CGFloat = -1

    var body: some View {
        Canvas { context, canvasSize in
            let w = canvasSize.width
            let h = max(canvasSize.height, 1)
            let t = CGFloat(elapsed)

            // The curve holds at the line band, then rises to the top; its
            // waviness eases (but never fully flattens) as it becomes water.
            // Rise and depth both reach full exactly at the second stop (0.36),
            // where `colorFormationPlate` hands over to the whole plate — so the
            // mask already covers the screen at the hand-off, with no top gap.
            let rise = HushTideTimeline.smoothstep(progress, 0.10, 0.36)
            let baseY = (lineBaseline - lineBaseline * rise) * h
            let amp = waveGain * (1 - 0.45 * HushTideTimeline.smoothstep(progress, 0.2, 0.5))

            // Colour seeps a little above the line, and a water body thickens
            // downward beneath it — both overlapping the rise, never after it.
            let up = h * (0.02 + 0.06 * HushTideTimeline.smoothstep(progress, 0.02, 0.22))
            let depth = h * (0.05 + 1.9 * HushTideTimeline.smoothstep(progress, 0.05, 0.36))

            func curveY(_ x: CGFloat) -> CGFloat {
                let dev = HushLineProfile.deviation(x / max(w, 1), t: t)
                return baseY + waveSign * dev * amp * h
            }

            let step = max(2, w / 140)
            var columns: [CGFloat] = []
            var x: CGFloat = 0
            while x < w { columns.append(x); x += step }
            columns.append(w)

            var path = Path()
            path.move(to: CGPoint(x: 0, y: curveY(0) - up))
            for x in columns {
                path.addLine(to: CGPoint(x: x, y: curveY(x) - up))
            }
            for x in columns.reversed() {
                path.addLine(to: CGPoint(x: x, y: min(h, curveY(x) + depth)))
            }
            path.closeSubpath()
            context.fill(path, with: .color(.white))
        }
        // Soft, slightly irregular edge — a watercolour front, not a vector line.
        .blur(radius: max(1, size.height * 0.02))
    }
}

/// The single tide-transition timeline.
///
/// The swipe is only a *trigger*: once armed, the whole transition plays itself
/// on ONE fixed clock — the seconds elapsed since it started — and never reads
/// the finger again. Everything visible (the rising water, the reading surface
/// emerging behind it, the messages it leaves behind) is a pure function of that
/// clock, so the three can neither drift out of sync nor read as separate
/// transitions bolted together.
///
/// Two mappings share that one clock but on purpose run at DIFFERENT speeds:
///
/// * The **water** rises slowly over the full `tideDuration` with a custom
///   velocity — a small quick establish, a long steady swell, a gentle ease to
///   rest — via `tideProgress(elapsed:)`.
/// * The **messages** ride a tight, fixed cadence (`messageReveal(elapsed:)`):
///   the extra runtime buys a longer, more finely-formed swell, NOT slower
///   messages. Their stagger stays ~0.06 s no matter how long the swell is.
///
/// Because both come from the same elapsed value they stay causally linked (the
/// messages begin mid-to-late swell, in the water's wake), while each keeps the
/// speed its own part of the story needs. Retuning the choreography is editing
/// these constants; there are no competing timers to keep in agreement.
enum HushTideTimeline {
    /// Total length of the automatic transition, in seconds. Long and unhurried
    /// so the line→colour→wave morph has room to be finely formed — the added
    /// time goes to the swell, never to gaps between phases.
    static let tideDuration: TimeInterval = 4.3

    /// Progress at which the drawn lines have fully become water. Mirrors
    /// `HushWaveBackground`'s second locked stop, so the wave view and the page
    /// reveal are phrased against the same 0…1 water progress.
    static let lineToFillEnd: CGFloat = 0.36

    /// The dark reading surface begins to rise out from behind the water here —
    /// ahead of the first message, so the page is already present to catch the
    /// content the tide deposits on it.
    static let pageRevealStart: CGFloat = 0.42
    static let pageRevealEnd: CGFloat = 0.99

    /// Message cadence, in seconds from the trigger. The cascade opens mid-swell
    /// (the water is already well up the screen) and each row follows the last
    /// by `messageStagger` — deliberately independent of `tideDuration` so the
    /// stream stays tight even as the swell is lengthened.
    static let messageStart: TimeInterval = 2.2
    static let messageStagger: TimeInterval = 0.06
    static let messageRowDuration: TimeInterval = 0.5

    // MARK: - Water progress (the master swell)

    /// The water's 0 → 1 progress at `elapsed` seconds. Custom velocity: a brisk
    /// but gentle establish so the push registers at once, a long near-steady
    /// swell through the middle, then an ease to rest as the messages settle —
    /// no constant-speed slab, no spring, no overshoot, continuous curvature.
    static func tideProgress(elapsed: TimeInterval) -> CGFloat {
        let u = clamp(CGFloat(elapsed / tideDuration), lower: 0, upper: 1)
        return cubicBezierEase(u, 0.12, 0.16, 0.62, 1.0)
    }

    /// A CSS-style cubic-bezier easing (P0 = 0, P3 = 1, controls (x1,y1)/(x2,y2)),
    /// evaluated by inverting x with a few Newton steps. Used instead of a stock
    /// `Animation` curve because the water is driven frame-by-frame off the
    /// clock, not by `withAnimation`, and this keeps the whole velocity profile
    /// in one inspectable place.
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

    // MARK: - Page surface (derived from water progress)

    static func pageFront(_ p: CGFloat) -> CGFloat {
        smoothstep(p, pageRevealStart, pageRevealEnd)
    }

    /// Opacity of the settled reading surface. Leads the messages (starts to
    /// darken behind the water before the first row arrives) and reaches fully
    /// opaque before the very end, so the surface is solid in time to hide the
    /// wave view resetting behind the finished inbox.
    static func pageOpacity(_ p: CGFloat) -> CGFloat {
        smoothstep(p, 0.35, 0.9)
    }

    // MARK: - Messages (tight cadence, own clock)

    /// Local reveal (0…1) for the row at `index`, purely a function of elapsed
    /// seconds. Row 0 (top) opens first and each following row `messageStagger`
    /// later, top → bottom, so the group reads as one continuous downward stream
    /// left in the tide's wake — tight regardless of how long the swell runs.
    static func messageReveal(elapsed: TimeInterval, index: Int) -> CGFloat {
        let start = messageStart + Double(index) * messageStagger
        return smoothstep(
            CGFloat(elapsed),
            CGFloat(start),
            CGFloat(start + messageRowDuration)
        )
    }

    // MARK: - Shared helpers

    /// Feathered "the water has passed here" gradient: opaque (black) above the
    /// `front`, clear below, with a soft band across it so the edge reads as a
    /// wave front, not a ruled line. Shared by the wave line-flood mask and the
    /// page-surface mask so both fronts feather identically. `front` may exceed
    /// 1 to drive the feather cleanly off the bottom edge (fully opaque).
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

    /// Smoothstep — C1 continuous, zero derivative at both ends.
    static func smoothstep(_ v: CGFloat, _ a: CGFloat, _ b: CGFloat) -> CGFloat {
        guard b > a else { return v >= b ? 1 : 0 }
        let t = clamp((v - a) / (b - a), lower: 0, upper: 1)
        return t * t * (3 - 2 * t)
    }

    static func clamp(_ v: CGFloat, lower: CGFloat, upper: CGFloat) -> CGFloat {
        min(upper, max(lower, v))
    }
}

/// A snapshot of the tide clock handed to the inbox: the water progress that
/// drives the reading surface, and the elapsed seconds that drive the tight
/// message cadence.
struct HushTideReveal {
    /// Master water progress (0…1) — feeds the page surface.
    var progress: CGFloat
    /// Seconds since the tide was triggered — feeds the message cadence.
    var elapsed: TimeInterval

    /// Fully settled: the inbox as an ordinary, interactive screen. `elapsed` is
    /// pushed far past the cascade so every row reads fully revealed.
    static let settled = HushTideReveal(progress: 1, elapsed: 1_000_000)
}

/// The reading surface, rising out from behind the tide.
///
/// Driven frame-by-frame off the tide clock (not `withAnimation`), so the mask
/// sweep is re-derived every frame rather than cross-faded between endpoints —
/// which would collapse it into a plain opacity fade.
struct HushTidePageSurface: View {
    var progress: CGFloat

    var body: some View {
        // A little overshoot so that at progress == 1 the feather has travelled
        // clear off the bottom edge and the surface is genuinely opaque, ready
        // to hide the wave view as it resets behind the finished inbox.
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

/// Brings a single row out of the water as the tide passes its slot.
///
/// Position (a short upward drift), opacity and a soft blur resolve together —
/// no spring, no scale, nothing flying in from off-screen. Driven off elapsed
/// seconds; the enclosing `TimelineView` re-runs it each frame, so no
/// `Animatable` conformance is needed.
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
    /// Reveal this row as the tide passes its vertical slot. With `.settled`'s
    /// large elapsed (the default inbox state) this is a no-op, so a directly
    /// presented inbox behaves exactly as an un-instrumented one.
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

/// Dedicated Work / Always-On Companion background.
///
/// Kept separate from `HushWaveBackground` (which the Door → Inbox demo depends
/// on, with its own landscape plates and measured motion model) so this screen
/// can raise the idle-line placement and use the portrait exit plates without
/// disturbing that work.
///
/// Everything is a function of one driver, `exitProgress` (0 = idle Work state,
/// 1 = fully exited):
///  • the luminous idle lines — raised, breathing — that stretch up and hand
///    over as the swipe begins;
///  • one continuously rendered cellular-foam material. Its three reference
///    plates overlap and morph under local refraction while irregular edges
///    grow and erode the material, revealing black beneath it. They are never
///    presented as three discrete frames.
struct HushCompanionBackground: View, Animatable {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var idleStartedAt = Date()

    var exitProgress: CGFloat = 0
    /// 0 = idle placement; 1 = the reading (expanded details) state, where the
    /// lines settle toward the lower edge and dim so no bright stroke crosses the
    /// text. It is a polite step out of the way, never a disappearance.
    var readingLower: CGFloat = 0

    /// Animate on the exit progress so the foam's position and organic warp are
    /// re-derived every frame from one continuous value.
    var animatableData: CGFloat {
        get { exitProgress }
        set { exitProgress = newValue }
    }

    /// Lift the idle lines from the artwork's low placement to ~58–60% of height
    /// (fraction of screen height translated upward).
    private let idleRaise: CGFloat = 0.25
    /// Breathing tempo: the shader's ~17 s dominant period becomes ~9 s — the
    /// calm 8–10 s wave the design asks for, still far from rapid oscillation.
    private let breathScale: Double = 1.85

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

    // MARK: - Idle luminous lines (raised, breathing)

    @ViewBuilder
    private func idleLines(size: CGSize, progress: CGFloat) -> some View {
        // Present only through the first sliver of the swipe: the first ocean
        // plate carries its own pale line-boundaries, so the live lines hand
        // over to it rather than lingering as a second set of bright strokes.
        let visible = 1 - HushTideTimeline.smoothstep(progress, 0, 0.30)

        let lower = min(1, max(0, readingLower))

        if visible > 0.001 {
            // Stretch a little upward with the gesture, and let the breathing
            // settle, so the curve reaches toward the arriving water.
            let lift = size.height * 0.05
                * HushTideTimeline.smoothstep(progress, 0, 0.24)
            let calm = (1 - 0.6 * HushTideTimeline.smoothstep(progress, 0, 0.22))
                * (1 - 0.55 * lower)                     // quieter while reading
            // Settle toward the lower edge and dim for the reading state.
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

    /// Native size of the warm-ivory idle plate (reference Image 1). Portrait,
    /// so it fills the phone with almost no crop and the strokes keep Image 1's
    /// exact placement and colour.
    private static let idlePlateSize = CGSize(width: 941, height: 1672)

    /// The idle plate, its ivory strokes floated by `hushLineFloat` — a generic
    /// organic displacement (no measured profile), so the hand-drawn texture is
    /// preserved while the threads breathe like weightless lines in water.
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
        let scale = HushWaveMotion.fillScale(for: size, source: source)
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

    // MARK: - Continuously rendered foam

    /// The three paintings are material samples, not animation frames. They
    /// overlap through broad blend windows while each receives a slightly
    /// different local refraction. One shared erosion shader gives the combined
    /// material a soft, irregular growing and retreating edge.
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

    /// Keep every plate anchored to the viewport. Only a small refraction bends
    /// its cells, so there is no slide-like movement of the overall rectangle.
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

    // MARK: - Bundled bitmap loader (cached)

    /// Decode each plate once. `body` re-evaluates every frame while the exit
    /// animates, so re-reading these 1–2 MB PNGs per frame would stutter; the
    /// cache keeps the compositor fed from memory. Main-thread only (SwiftUI
    /// renders on the main actor), so the plain dictionary is safe.
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
