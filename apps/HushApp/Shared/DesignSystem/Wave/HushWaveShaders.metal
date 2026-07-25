#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>

using namespace metal;

constant float HUSH_TAU = 6.28318530718;

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
    float env = 0.32 + 0.68 * sin(M_PI_F * x);
    float lane = clamp(position.y / h, 0.0, 1.0);

    float dy = 0.0;
    dy += sin(x * HUSH_TAU * 1.0 + time * 0.66 + lane * 1.2) * 0.55;
    dy += sin(x * HUSH_TAU * 1.7 - time * 0.44 + lane * 0.7 + 1.3) * 0.30;
    dy += sin(x * HUSH_TAU * 0.6 + time * 0.30 - lane * 0.5 + 2.1) * 0.26;

    float breathe = 0.72 + 0.28 * sin(time * 0.34 + lane * 0.4);
    dy *= env * breathe;

    float reach = 0.055 * h * amplitude;
    return float2(position.x, position.y - dy * reach);
}

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
    float noise = hushFoamNoise(
        uv * float2(2.4, 3.1) + float2(time * 0.035, -time * 0.018)
    );
    float feather = 0.075;

    float revealFront = mix(1.16, -0.16, clamp(reveal, 0.0, 1.0));
    float revealMask = smoothstep(
        revealFront + feather,
        revealFront - feather,
        uv.y + noise * 0.055
    );

    float retreatFront = mix(1.16, -0.16, clamp(retreat, 0.0, 1.0));
    float retreatMask = smoothstep(
        retreatFront - feather,
        retreatFront + feather,
        uv.y + noise * 0.07
    );

    color.a *= half(clamp(revealMask * retreatMask, 0.0, 1.0));
    return color;
}
