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

            // The very waterline that reveals the first ocean plate (index 1).
            // Feeding it to the line's mask means the line is consumed from the
            // bottom up by exactly the rising colour block, so the line turns
            // into that block's leading edge — a continuous wipe from line to
            // fill, never a cross-fade.
            let flood = min(1, max(0, linearRamp(
                progress,
                from: Self.stops[0],
                to: Self.stops[1]
            )))

            ZStack {
                Color.black

                TimelineView(
                    .animation(
                        minimumInterval: 1.0 / 60.0,
                        paused: !animateLine
                    )
                ) { timeline in
                    let elapsed = animateLine
                        ? timeline.date.timeIntervalSince(idleStartedAt)
                        : 0

                    floodedLinePlate(
                        size: size,
                        elapsed: elapsed,
                        flood: flood
                    )
                }

                oceanPlate(
                    named: "hush-wave-keyframe-02",
                    index: 1,
                    size: size,
                    progress: progress
                )

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

    /// The line plate, being flooded away from the bottom up by the rising
    /// colour block. Above the waterline the line is untouched (still lulling);
    /// across a short feathered band it dissolves into the wave's leading edge;
    /// below it the ocean plate has taken over. At `flood == 0` the mask is
    /// bypassed entirely so the idle frame stays pixel-exact.
    @ViewBuilder
    private func floodedLinePlate(
        size: CGSize,
        elapsed: TimeInterval,
        flood: CGFloat
    ) -> some View {
        if flood <= 0.0001 {
            linePlate(size: size, elapsed: elapsed)
        } else {
            // The line plate aspect-fills and overflows the screen; constraining
            // its frame here makes the mask align to the screen box (and hence
            // to the ocean plate's waterline) rather than to the overflow.
            let band = max(1, size.height * 0.07)
            let advance = flood * (size.height + band)
            let front = (size.height - advance) / size.height

            linePlate(size: size, elapsed: elapsed)
                .frame(width: size.width, height: size.height)
                .mask(
                    LinearGradient(
                        stops: HushTideTimeline.frontGradientStops(
                            front: front,
                            feather: band / size.height
                        ),
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
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

/// The single tide-transition timeline.
///
/// Every visible piece of the "swipe up → tide → inbox" transition is a pure
/// function of ONE driver — `HushWaveBackground.revealProgress` ∈ [0, 1]. The
/// rising water, the reading surface emerging from behind it and the messages it
/// leaves behind are therefore incapable of drifting out of sync or reading as
/// three separate transitions bolted together: they are three views of the same
/// clock.
///
/// The sub-progresses below deliberately OVERLAP. The water is still climbing
/// while the page is already surfacing behind it, and the first messages arrive
/// before the water has finished sweeping past. Because every window is derived
/// here and nowhere else, retuning the choreography is editing these constants —
/// there are no independent timers, booleans or completion callbacks to keep in
/// agreement.
enum HushTideTimeline {
    /// Progress at which the drawn lines have fully become water. Mirrors
    /// `HushWaveBackground`'s second locked stop, so the page and message reveal
    /// are phrased on the very same timeline as the wave motion.
    static let lineToFillEnd: CGFloat = 0.36

    /// The dark reading surface begins to rise out from behind the water here —
    /// just AHEAD of the first message, so the page is already present to catch
    /// the content the tide deposits on it.
    static let pageRevealStart: CGFloat = 0.42
    static let pageRevealEnd: CGFloat = 0.99

    /// The tide front that carries the messages sweeps the reading area across
    /// this window. It overlaps both the wave rise (0.36 → 1) and the page
    /// reveal, so the content is visibly *brought out by* the water rather than
    /// appearing after it has gone.
    static let messageFrontStart: CGFloat = 0.46
    static let messageFrontEnd: CGFloat = 0.98

    /// How much of the reading area a single row's own reveal is spread across,
    /// in normalised height. Larger = softer, with more overlap between
    /// neighbouring rows. Tuned so an adjacent row begins while its predecessor
    /// is only ~20–30% in — a tight, heavily-overlapped flow, not a roll-call.
    static let rowRevealBand: CGFloat = 0.42

    // MARK: - Derived sub-progresses

    /// 0 → 1 as the lines thicken into water. Informational: the wave view owns
    /// the actual line→fill wipe, but exposing it here keeps the phase boundary
    /// in one place.
    static func lineToFill(_ p: CGFloat) -> CGFloat {
        smoothstep(p, 0, lineToFillEnd)
    }

    /// Normalised position of the tide front, 0 at the top of the screen, 1 at
    /// the bottom. The front sweeps DOWNWARD as the water settles: the region it
    /// has passed (above it) has become reading surface, the region ahead (below
    /// it) is still open water.
    static func messageFront(_ p: CGFloat) -> CGFloat {
        smoothstep(p, messageFrontStart, messageFrontEnd)
    }

    static func pageFront(_ p: CGFloat) -> CGFloat {
        smoothstep(p, pageRevealStart, pageRevealEnd)
    }

    /// Opacity of the settled reading surface. Kept partly translucent through
    /// the middle of the transition — so the water still reads behind the
    /// freshly-deposited messages — and only fully opaque at the very end, where
    /// it has to hide the wave view resetting behind it.
    static func pageOpacity(_ p: CGFloat) -> CGFloat {
        smoothstep(p, 0.5, 1.0)
    }

    /// Local reveal (0…1) for the row at `index` of `count`, driven purely by
    /// how far the tide front has swept past that row's vertical slot. Row 0
    /// (top) is reached first and the last row last, but with heavy overlap so
    /// the group reads as one continuous stream rather than items taking turns.
    static func messageReveal(progress p: CGFloat, index: Int, count: Int) -> CGFloat {
        let front = messageFront(p)
        let q = count > 1 ? CGFloat(index) / CGFloat(count - 1) : 0
        let start = q * (1 - rowRevealBand)
        return smoothstep(front, start, start + rowRevealBand)
    }

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

    // MARK: - Helpers

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

/// The reading surface, rising out from behind the tide.
///
/// `Animatable` on the shared progress so that a released, decelerating gesture
/// re-derives the mask every frame — rather than SwiftUI cross-fading a start
/// snapshot to an end snapshot, which would collapse the sweep into a plain
/// opacity fade (exactly the effect the transition is meant to avoid).
struct HushTidePageSurface: View, Animatable {
    var progress: CGFloat

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

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

/// Brings a single row out of the water as the tide front passes its slot.
///
/// Position (a short upward drift), opacity and a soft blur resolve together —
/// no spring, no scale, nothing flying in from off-screen. `Animatable` on the
/// shared progress for the same reason as `HushTidePageSurface`: the per-row
/// timing has to be re-evaluated at every interpolated progress value, not
/// linearly tweened between endpoints.
struct HushTideMessageReveal: ViewModifier, Animatable {
    var progress: CGFloat
    let index: Int
    let count: Int
    var reduceMotion: Bool

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    func body(content: Content) -> some View {
        let reveal = HushTideTimeline.messageReveal(
            progress: progress,
            index: index,
            count: count
        )
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
    /// Reveal this row as the tide front sweeps past its vertical slot. At
    /// `progress == 1` (the default reveal state) this is a no-op, so a fully
    /// settled inbox behaves exactly as an un-instrumented one.
    func hushTideReveal(
        index: Int,
        count: Int,
        progress: CGFloat,
        reduceMotion: Bool
    ) -> some View {
        modifier(
            HushTideMessageReveal(
                progress: progress,
                index: index,
                count: count,
                reduceMotion: reduceMotion
            )
        )
    }
}
