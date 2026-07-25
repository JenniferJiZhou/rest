#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>

using namespace metal;

// Displacement-field warp for the Hush Door line plate (keyframe-01).
//
// This is a pure resampling of the ORIGINAL bitmap: the shader only decides
// *where to read from*, it never draws, recolours or reshapes a stroke. The
// hand-drawn broken/dry-brush texture therefore travels with its own pixels.
//
// The field is a sum of standing waves whose temporal periods (9 / 12.5 / 15 /
// 23 s) are mutually incommensurate, so the motion never repeats exactly and
// there is no loop seam to jump at. Every term is a sine of time, so the field
// is C-infinity in both space and time: velocity and acceleration are
// continuous, giving the soft ease at maximum deformation with no kinks.
//
// `amplitude` is ramped from 0 by the caller, so at t = 0 (and whenever Reduce
// Motion is on) the mapping is the exact identity and the plate renders as the
// untouched original.
[[ stitchable ]] float2 hushThreadDrift(
    float2 position,
    float time,
    float2 size,
    float amplitude
) {
    if (amplitude <= 0.0) {
        return position;
    }

    float width = max(size.x, 1.0);
    float height = max(size.y, 1.0);
    float nx = position.x / width;
    float ny = position.y / height;

    // Calm at the left/right ends, greatest deformation near the centre.
    float edge = pow(max(0.0, sin(nx * M_PI_F)), 1.6);

    // Vertical phase offset so neighbouring lines bend independently and lag
    // one another slightly, rather than moving as one rigid sheet.
    float lane = ny * 2.6;

    const float tau = 6.28318530718;

    float w1 = sin(nx * 3.1 + 0.4 + lane) * sin(time * (tau / 9.0));
    float w2 = sin(nx * 5.7 + 1.7 - lane * 0.6) * sin(time * (tau / 15.0) + 0.9);
    float w3 = sin(nx * 2.2 - 0.6 + lane * 0.35) * sin(time * (tau / 12.5) + 2.1);

    // Tiny long-period breathing so the loop never looks mechanical.
    float slow = 0.82 + 0.18 * sin(time * (tau / 23.0));

    float dy = (w1 * 2.8 + w2 * 1.4 + w3 * 1.8) * edge * slow * amplitude;

    // Horizontal component is deliberately an order of magnitude smaller: it
    // keeps the threads from looking like a rigid vertical shear without
    // smearing the strokes sideways.
    float dx = sin(ny * 3.7 + time * (tau / 19.0)) * edge * 0.45 * amplitude;

    return float2(position.x + dx, position.y + dy);
}
