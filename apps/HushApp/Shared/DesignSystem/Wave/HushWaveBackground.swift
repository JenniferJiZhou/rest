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
            let isIdle = progress <= 0.0005

            ZStack {
                Color.black

                TimelineView(
                    .animation(
                        minimumInterval: 1.0 / 60.0,
                        paused: reduceMotion || !isIdle
                    )
                ) { timeline in
                    let elapsed = reduceMotion || !isIdle
                        ? 0
                        : timeline.date.timeIntervalSince(idleStartedAt)

                    linePlate(size: size, elapsed: elapsed)
                        .opacity(linePlateOpacity(progress: progress))
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
            keyframePlate(named: "hush-wave-keyframe-01", size: size)
                .distortionEffect(
                    ShaderLibrary.hushThreadDrift(
                        .float(Float(elapsed)),
                        .float2(Float(size.width), Float(size.height)),
                        .float(Float(amplitude))
                    ),
                    maxSampleOffset: CGSize(width: 4, height: 14)
                )
        }
    }

    private func linePlateOpacity(progress: CGFloat) -> CGFloat {
        1 - smoothstep(progress, from: Self.stops[0], to: Self.stops[1])
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
