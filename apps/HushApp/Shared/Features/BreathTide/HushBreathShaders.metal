#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>

using namespace metal;

// Shaders for the breath session only. The door and the companion have their
// own effects in HushWaveShaders.metal and are untouched by anything here.

static float hushHash21(float2 p) {
    p = fract(p * float2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

static float hushValueNoise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hushHash21(i);
    float b = hushHash21(i + float2(1.0, 0.0));
    float c = hushHash21(i + float2(0.0, 1.0));
    float d = hushHash21(i + float2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Three octaves, not four. This runs per pixel several times over a full-screen
// layer at 60 fps; the fourth octave cost about a third more for detail the
// foam's own texture already supplies.
static float hushFbm(float2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 3; i++) {
        sum += amp * hushValueNoise(p);
        p *= 2.03;
        amp *= 0.5;
    }
    return sum / 0.875;   // renormalise to keep the 0…1 range
}

// Foam veil: a slow fluid wobble plus a top-down erosion of the layer's alpha.
//
// The exhale must not look like a picture sliding away, so nothing here moves
// the plate. Instead the boundary between "still foam" and "already gone" is a
// noisy contour that sweeps down the screen, and pixels above it are dissolved
// away. Three things shape that contour:
//
//   * low-frequency fbm, which gives it large irregular lobes rather than a rule;
//   * the foam's OWN luminance, so the dissolve follows the drawn cell walls —
//     dark cell interiors thin out first and the pale rims hold on a moment
//     longer, exactly as a real foam collapses;
//   * a finer grain that breaks the leading band into patches, so the edge
//     erodes instead of wiping.
//
// `front` runs 0 → 1 across the exhale, `drift` scales the wobble (0 under
// Reduce Motion), and `time` only ever feeds slow motion — never the geometry
// of the sweep, so the retreat is monotonic and never reverses.
[[ stitchable ]] half4 hushFoamVeil(
    float2 position,
    SwiftUI::Layer layer,
    float2 size,
    float front,
    float drift,
    float time
) {
    float2 extent = max(size, float2(1.0, 1.0));
    float2 uv = position / extent;

    // Skip the wobble entirely when it is switched off (Reduce Motion), so the
    // still frames cost nothing extra.
    half4 colour;
    if (drift > 0.0) {
        float2 wobble = float2(
            hushFbm(uv * 3.1 + float2(0.0, time * 0.045)) - 0.5,
            hushFbm(uv * 2.7 + float2(time * 0.037, 1.7)) - 0.5
        );
        colour = layer.sample(position + wobble * drift * extent.y);
    } else {
        colour = layer.sample(position);
    }

    if (front <= 0.0) {
        return colour;
    }

    float soft = 0.17;
    float edge = mix(-soft, 1.0 + soft, front);

    float lobes = hushFbm(uv * float2(2.2, 3.4) + float2(0.0, time * 0.03));
    float luma = dot(float3(colour.rgb), float3(0.299, 0.587, 0.114));

    // Where this pixel sits relative to the sweep, once pushed around by the
    // noise and by the artwork's own structure.
    float threshold = uv.y
        + (lobes - 0.5) * 0.30
        + (luma - 0.22) * 0.16;

    float alpha = smoothstep(edge - soft, edge + soft, threshold);

    // Patchy break-up right at the front, fading back to solid further below.
    float grain = hushFbm(uv * 9.0 + float2(time * 0.02, 0.0));
    float nearFront = 1.0 - smoothstep(0.0, 0.42, threshold - edge);
    float patches = smoothstep(0.16, 0.74, grain + (threshold - edge) * 1.7);
    alpha *= mix(1.0, patches, nearFront * 0.72);

    return colour * half(clamp(alpha, 0.0, 1.0));
}
