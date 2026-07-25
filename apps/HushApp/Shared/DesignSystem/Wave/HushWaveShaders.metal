#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>

using namespace metal;

constant float HUSH_TAU = 6.28318530718;

// The line plate's OWN wave, measured off hush-wave-keyframe-01.png: for every
// column, the row of the brightest pixel, smoothed, mean-removed and normalised
// to [-1, 1]. Half-amplitude is 0.1154 of image height; the profile changes
// sign eight times across the width (spatial frequency n ~ 5).
//
// Driving the deformation with the artwork's own profile is what makes a peak
// able to become a trough. A displacement field that does not change sign
// across the width can only lift or lower the line as a whole — which is
// exactly the rigid translation we must avoid.
constant float HUSH_PROFILE[32] = {
     0.4335,  0.3433,  0.1075, -0.2614, -0.6332, -0.7101, -0.2774,  0.1374,
     0.2561,  0.1407,  0.0512,  0.1349,  0.2960,  0.2785, -0.1796, -0.7780,
    -0.9986, -0.8040, -0.3439,  0.1672,  0.5086,  0.6163,  0.4511,  0.0693,
    -0.0657,  0.0899,  0.3617,  0.4662,  0.3414,  0.0550, -0.0281,  0.0309
};

constant float HUSH_HALF_AMP = 0.1154;   // of plate height

static float hushProfile(float x) {
    float f = clamp(x, 0.0, 1.0) * 31.0;
    int i = int(floor(f));
    float g = fract(f);
    g = g * g * (3.0 - 2.0 * g);          // smooth interpolation between samples
    int a = clamp(i, 0, 31);
    int b = clamp(i + 1, 0, 31);
    return mix(HUSH_PROFILE[a], HUSH_PROFILE[b], g);
}

// Low-frequency tension riding on top of the inversion. Spatial orders 3/4/6
// roughly match the artwork's own hump count, so this changes local steepness
// and curvature rather than sliding a shape sideways. Periods 11 / 17 / 23 s
// are mutually incommensurate, so the combined motion never repeats exactly
// and there is no loop point to jump at.
static float hushTension(float x, float t, float lane) {
    float s = 0.0;
    s += sin(3.0 * M_PI_F * x + 0.7) * cos(t * (HUSH_TAU / 11.0) + lane * 0.9) * 0.34;
    s += sin(4.0 * M_PI_F * x - 1.2) * cos(t * (HUSH_TAU / 17.0) + 1.7 + lane * 0.6) * 0.26;
    s += sin(6.0 * M_PI_F * x + 2.3) * cos(t * (HUSH_TAU / 23.0) + 0.4 - lane * 0.5) * 0.15;
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
             + HUSH_HALF_AMP * hushTension(x, time, lane) * 0.95;

    return float2(position.x, position.y - dy * h * amplitude);
}
