#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>

using namespace metal;

constant float HUSH_TAU = 6.28318530718;

// The line plate's OWN wave, measured off hush-wave-keyframe-01.png.
//
// Per column the luminance-weighted centroid is taken (not the brightest
// pixel: argmax hops between lines wherever they cross, and that noise shows
// up as visible kinks once it drives a warp). The mean-removed profile is then
// fitted with a half-range cosine series, which is orthogonal on [0,1]. Ten
// terms reach 0.111 RMS while carrying only 0.7% of the raw profile's
// roughness — the reconstruction is band-limited, so the field it drives
// cannot crease the strokes.
//
// Extrema of the fit sit at x = 0.13, 0.37, 0.52, 0.66, 0.77, 0.87, matching
// the humps actually drawn. Driving the deformation with the artwork's own
// profile is what lets a crest become a trough: a field that does not change
// sign across the width could only raise or lower the line as a whole, which
// is precisely the rigid translation to avoid.
constant float HUSH_PA[10] = {
    -0.10940, +0.06590, +0.01073, -0.20969, +0.19923,
    +0.40161, +0.12943, -0.15172, +0.29027, +0.08905
};

constant float HUSH_HALF_AMP = 0.0988;   // of plate height

static float hushProfile(float x) {
    float u = clamp(x, 0.0, 1.0) * M_PI_F;
    float s = 0.0;
    for (int n = 1; n <= 10; n++) {
        s += HUSH_PA[n - 1] * cos(float(n) * u);
    }
    return s;
}

// Low-frequency tension riding on top of the inversion, changing local
// steepness rather than sliding a shape sideways. Orders are kept to 2/3/4:
// anything higher reads as the strokes crinkling rather than flexing. Periods
// 11 / 17 / 23 s are mutually incommensurate, so the combined motion never
// repeats exactly and there is no loop point to jump at.
static float hushTension(float x, float t, float lane) {
    float s = 0.0;
    s += sin(2.0 * M_PI_F * x + 0.7) * cos(t * (HUSH_TAU / 11.0) + lane * 0.9) * 0.34;
    s += sin(3.0 * M_PI_F * x - 1.2) * cos(t * (HUSH_TAU / 17.0) + 1.7 + lane * 0.6) * 0.24;
    s += sin(4.0 * M_PI_F * x + 2.3) * cos(t * (HUSH_TAU / 23.0) + 0.4 - lane * 0.5) * 0.12;
    return s;
}

// Local morphing warp for the Hush Door line plate.
//
// This only chooses where to SAMPLE the original bitmap — it never draws,
// recolours or re-strokes anything, so the hand-drawn broken/dry-brush texture
// travels with its own pixels and line count, weight, colour and opacity are
// structurally unable to change.
//
// The field is:
//
//     dy(x,t) = HALF_AMP * profile(x) * (s(x,t) - 1)      <- peak <-> trough
//             + HALF_AMP * tension(x,t) * 0.95            <- local tension
//
//     s(x,t) = 0.25 + 0.75 * cos(2*pi*t/17 + 5.5x + lane)
//
// Because the first term is proportional to profile(x), and profile(x) changes
// sign across the width, neighbouring humps are always pushed in OPPOSITE
// directions. The field therefore has no constant component and cannot degrade
// into "move the whole line up and down".
//
// s starts at 1 (dy = 0, pixel-exact original) and swings to -0.5. At s = -0.5
// a point's deviation from the mean line becomes -0.5x its original: an
// original crest is carried down through the mean line and out the other side
// as a trough, and an original trough rises into a crest. The phase lags along
// x (the 5.5x term), so the inversion sweeps through the curve like energy
// travelling inside a rope instead of the whole curve flattening at once — and
// each line gets its own lane phase so they never move in lockstep.
[[ stitchable ]] float2 hushThreadDrift(
    float2 position,
    float time,
    float2 plate,
    float amplitude
) {
    if (amplitude <= 0.0) {
        return position;
    }

    float w = max(plate.x, 1.0);
    float h = max(plate.y, 1.0);
    float x = clamp(position.x / w, 0.0, 1.0);

    // Per-line phase. Deliberately gentle: d(dy)/dy has to stay far below 1 or
    // the strokes would stretch vertically and their apparent weight would
    // change, which the design forbids.
    float lane = clamp(position.y / h, 0.0, 1.0) * 1.6;

    float s = 0.25 + 0.75 * cos(time * (HUSH_TAU / 17.0) + x * 5.5 + lane * 0.5);

    // `dy` is expressed in artwork terms: positive means "this part of the
    // curve should sit higher on screen". distortionEffect moves content the
    // opposite way for a positive y offset (verified by measuring rendered
    // frames, not by reading the docs), hence the negation.
    float dy = HUSH_HALF_AMP * hushProfile(x) * (s - 1.0)
             + HUSH_HALF_AMP * hushTension(x, time, lane) * 0.55;

    return float2(position.x, position.y - dy * h * amplitude);
}
