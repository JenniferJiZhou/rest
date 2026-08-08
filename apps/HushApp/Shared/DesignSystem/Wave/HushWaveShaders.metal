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
// Six terms, renormalised so the series spans [-1, 1]. Ten terms tracked the
// measured profile more closely but carried enough high-order content that the
// warp put visible corners into the strokes: driving the field from the K=10
// fit peaked at 1.04x the artwork's own curvature, K=6 at 0.66x. Six keeps the
// humps where they belong (troughs 0.16 / 0.51 / 0.87, crests 0.33 / 0.70)
// while staying visibly rounder in motion.
constant float HUSH_PA[6] = {
    -0.15694, +0.09453, +0.01539,
    -0.30081, +0.28580, +0.57612
};

// The true half-amplitude of the measured profile. The six-term series only
// reaches ~66% of it, so it is renormalised above and scaled by the real figure
// here — otherwise the morph would undershoot and the shallower crests would
// never make it across the mean line.
constant float HUSH_HALF_AMP = 0.1037;   // of plate height

static float hushProfile(float x) {
    float u = clamp(x, 0.0, 1.0) * M_PI_F;
    float s = 0.0;
    for (int n = 1; n <= 6; n++) {
        s += HUSH_PA[n - 1] * cos(float(n) * u);
    }
    return s;
}

// Low-frequency tension riding on top of the inversion, changing local
// steepness rather than sliding a shape sideways. Orders are kept to 2/3/4:
// anything higher reads as the strokes crinkling rather than flexing. Periods
// 8 / 13 / 17 s share no common factor, so the combined motion never
// repeats exactly and there is no loop point to jump at.
static float hushTension(float x, float t, float lane) {
    float s = 0.0;
    s += sin(2.0 * M_PI_F * x + 0.7) * cos(t * (HUSH_TAU / 8.0) + lane * 0.9) * 0.34;
    s += sin(3.0 * M_PI_F * x - 1.2) * cos(t * (HUSH_TAU / 13.0) + 1.7 + lane * 0.6) * 0.24;
    s += sin(4.0 * M_PI_F * x + 2.3) * cos(t * (HUSH_TAU / 17.0) + 0.4 - lane * 0.5) * 0.12;
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
//     s(x,t) = 0.25 + 0.75 * cos(2*pi*t/13 + 6.5x + lane)
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

    float s = 0.25 + 0.75 * cos(time * (HUSH_TAU / 13.0) + x * 6.5 + lane * 0.5);

    // `dy` is expressed in artwork terms: positive means "this part of the
    // curve should sit higher on screen". distortionEffect moves content the
    // opposite way for a positive y offset (verified by measuring rendered
    // frames, not by reading the docs), hence the negation.
    //
    // Tension is held at 0.35. It is the one term that introduces curvature the
    // artwork does not already have, so it is the first thing to trim when the
    // strokes start reading as angular rather than flexing.
    float dy = HUSH_HALF_AMP * hushProfile(x) * (s - 1.0)
             + HUSH_HALF_AMP * hushTension(x, time, lane) * 0.35;

    return float2(position.x, position.y - dy * h * amplitude);
}

// Generic organic "floating threads" displacement for the Companion idle lines.
//
// Unlike hushThreadDrift, this carries no measured profile — it is meant for the
// warm-ivory idle plate (hush-companion-idle) whose stroke positions were not
// measured. It only chooses where to SAMPLE the bitmap, so the hand-drawn ivory
// texture, weight and colour travel with their own pixels; nothing is redrawn.
//
// The field is a small sum of incommensurate low-frequency waves in x and t,
// with a per-line phase (lane) so strokes at different heights bend
// independently and follow one another with a delay, and a centre-weighted
// envelope so the middle of the composition moves more than the calmer sides.
// A slow global breath expands and contracts the whole amplitude. Periods are
// ~9–16 s: a calm swell, never a rapid or mechanical oscillation.
[[ stitchable ]] float2 hushLineFloat(
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

    // Calmer at the edges, livelier through the middle.
    float env = 0.32 + 0.68 * sin(M_PI_F * x);

    // Per-line phase so different threads move independently, with a lag.
    float lane = clamp(position.y / h, 0.0, 1.0);

    float dy = 0.0;
    dy += sin(x * HUSH_TAU * 1.0 + time * 0.66 + lane * 1.2) * 0.55;
    dy += sin(x * HUSH_TAU * 1.7 - time * 0.44 + lane * 0.7 + 1.3) * 0.30;
    dy += sin(x * HUSH_TAU * 0.6 + time * 0.30 - lane * 0.5 + 2.1) * 0.26;

    // Slow overall breathing of the amplitude.
    float breathe = 0.72 + 0.28 * sin(time * 0.34 + lane * 0.4);
    dy *= env * breathe;

    // Half-amplitude reach, as a fraction of plate height.
    float reach = 0.055 * h * amplitude;
    return float2(position.x, position.y - dy * reach);
}

// Slow two-dimensional refraction for the Companion foam plates. This bends
// local cells in place; it deliberately has no large translation component, so
// the result reads as material changing shape rather than a bitmap flying past.
[[ stitchable ]] float2 hushFoamFlow(
    float2 position,
    float time,
    float2 plate,
    float amplitude,
    float phase
) {
    if (amplitude <= 0.0) {
        return position;
    }

    float w = max(plate.x, 1.0);
    float h = max(plate.y, 1.0);
    float2 uv = position / float2(w, h);

    float envelope = sin(M_PI_F * clamp(uv.y, 0.0, 1.0));
    float dx = sin(uv.y * HUSH_TAU * 2.1 + time * 0.72 + phase) * 0.55
             + sin((uv.x + uv.y) * HUSH_TAU * 1.2 - time * 0.43 + phase * 1.7) * 0.25;
    float dy = sin(uv.x * HUSH_TAU * 1.35 - time * 0.58 + phase * 0.8) * 0.48
             + cos((uv.x - uv.y) * HUSH_TAU * 0.9 + time * 0.36 + phase) * 0.24;

    float reach = min(w, h) * 0.018 * amplitude;
    return position + float2(dx, dy) * reach * (0.55 + 0.45 * envelope);
}

static float hushFoamNoise(float2 p) {
    float n = sin(p.x * 12.7 + sin(p.y * 4.1)) * 0.46;
    n += sin(p.y * 9.3 - p.x * 3.7 + 1.8) * 0.31;
    n += sin((p.x + p.y) * 19.1 + 0.7) * 0.14;
    return n;
}

// Gives the composited foam material an irregular leading and trailing edge.
// `reveal` grows it upward from the lower part of the screen; `retreat` erodes
// it upward again, leaving the black destination behind. The edge is feathered
// and noise-modulated, avoiding both a straight wipe and a full-frame dissolve.
[[ stitchable ]] half4 hushFoamErode(
    float2 position,
    half4 color,
    float2 plate,
    float reveal,
    float retreat,
    float time
) {
    float2 size = max(plate, float2(1.0));
    float2 uv = position / size;
    float noise = hushFoamNoise(uv * float2(2.4, 3.1) + float2(time * 0.035, -time * 0.018));
    float feather = 0.075;

    float revealFront = mix(1.16, -0.16, clamp(reveal, 0.0, 1.0));
    float revealMask = smoothstep(revealFront + feather, revealFront - feather, uv.y + noise * 0.055);

    float retreatFront = mix(1.16, -0.16, clamp(retreat, 0.0, 1.0));
    float retreatMask = smoothstep(retreatFront - feather, retreatFront + feather, uv.y + noise * 0.07);

    color.a *= half(clamp(revealMask * retreatMask, 0.0, 1.0));
    return color;
}
