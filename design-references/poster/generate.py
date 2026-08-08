#!/usr/bin/env python3
"""Generate the Hush poster background (80cm x 180cm) as a print-ready SVG."""

W, H = 800, 1800          # user units == millimetres
TITLE_BOTTOM = 640        # black block reserved for the title
FADE = 260                # how far the black melts into the water

def smooth(pts, k=0.52):
    """Cubic path through alternating extrema, horizontal tangent at each point.

    k sets how round the crests are: 0.42 gives spikes, 0.6 gives broad
    shoulders. Nudging it per segment keeps the crests from looking stamped.
    """
    d = f"M {pts[0][0]:.1f},{pts[0][1]:.1f}"
    for n, ((x0, y0), (x1, y1)) in enumerate(zip(pts, pts[1:])):
        ka, kb = (k, k + 0.09) if n % 2 else (k + 0.09, k)
        d += (f" C {x0 + (x1 - x0) * ka:.1f},{y0:.1f}"
              f" {x1 - (x1 - x0) * kb:.1f},{y1:.1f} {x1:.1f},{y1:.1f}")
    return d


# ---------------------------------------------------------------- composition
# Each band: crest extrema (alternating peak / trough), left to right.
# Drawn back to front; every band fills down to the bottom edge.
# Crests land ~90-110 units apart == 90-110 mm on the printed poster, i.e. one
# comfortable line of body copy per ribbon.
#
# tone: "sand" ribbons carry a warm wash in the middle and fade back to blue at
# both ends, like the reference; everything else is a two-stop blue.
#
# The top three are the hero peaks that carry the composition. Everything below
# is a long, gentle sweep across the full width — those are the ones a line of
# body copy rides on, so their amplitude stays under ~110 units and the crest
# never doubles back steeply.
BANDS = [
    # crest extrema                                                     fill          tone    hairline  k
    ([(-60, 1140), (165, 915), (400, 1120), (660, 720), (880, 970)], ("#4A6B82", "#3D6274"), "", 0.50, 0.54),
    ([(-60, 1075), (215, 1035), (455, 1300), (715, 860), (880, 1055)], ("#2F5872", "#345F6E"), "", 0.60, 0.54),
    ([(-60, 1005), (150, 1215), (395, 1070), (640, 1285), (880, 1040)], ("#316B76", "#2B5C6A"), "", 0.55, 0.56),

    ([(-60, 1300), (250, 1195), (565, 1335), (880, 1225)], ("#24425F", "#2A5065"), "", 0.72, 0.54),
    ([(-60, 1372), (205, 1288), (525, 1428), (835, 1305), (880, 1312)], ("#2E5A66", "#264E60"), "", 0.58, 0.54),
    ([(-60, 1455), (300, 1368), (610, 1498), (880, 1392)], ("#A28A68", "#24425E"), "sand", 0.64, 0.54),
    ([(-60, 1528), (230, 1462), (545, 1578), (880, 1478)], ("#1D3852", "#22485F"), "", 0.78, 0.54),
    ([(-60, 1602), (325, 1532), (625, 1655), (880, 1558)], ("#2C6069", "#23535C"), "", 0.62, 0.54),
    ([(-60, 1672), (262, 1618), (585, 1720), (880, 1628)], ("#8E7A5E", "#1B3247"), "sand", 0.80, 0.54),
    ([(-60, 1742), (340, 1692), (655, 1778), (880, 1706)], ("#17304A", "#1B3852"), "", 0.66, 0.54),
]


# where the warm wash sits inside a sand ribbon (fractions of the width)
SAND_SPAN = {5: (0.40, 1.06), 8: (-0.06, 0.44)}

out = []
A = out.append

A(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}mm" height="{H}mm" '
  f'viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice">')
A('<title>Hush poster background 80x180</title>')

# ------------------------------------------------------------------- defs
A('<defs>')

# painterly edge wobble
for n, (bf, seed, scale) in enumerate([("0.004 0.011", 7, 9), ("0.006 0.014", 23, 7)]):
    A(f'<filter id="paint{n}" filterUnits="userSpaceOnUse" x="-140" y="-60" width="1080" height="1960">'
      f'<feTurbulence type="fractalNoise" baseFrequency="{bf}" numOctaves="3" seed="{seed}" result="n"/>'
      f'<feDisplacementMap in="SourceGraphic" in2="n" scale="{scale}" '
      f'xChannelSelector="R" yChannelSelector="G"/></filter>')

# watercolour blooms (coarse), pigment mottle (fine), paper tooth
A('<filter id="bloom" x="0%" y="0%" width="100%" height="100%">'
  '<feTurbulence type="fractalNoise" baseFrequency="0.0022" numOctaves="4" seed="41"/>'
  '<feColorMatrix type="saturate" values="0"/>'
  '<feComponentTransfer><feFuncA type="table" tableValues="0 1"/></feComponentTransfer>'
  '</filter>')
A('<filter id="mottle" x="0%" y="0%" width="100%" height="100%">'
  '<feTurbulence type="fractalNoise" baseFrequency="0.011" numOctaves="5" seed="12"/>'
  '<feColorMatrix type="saturate" values="0"/>'
  '<feComponentTransfer><feFuncA type="table" tableValues="0 0.9"/></feComponentTransfer>'
  '</filter>')
A('<filter id="grain" x="0%" y="0%" width="100%" height="100%">'
  '<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3"/>'
  '<feColorMatrix type="saturate" values="0"/></filter>')

# soft haze so the black title block melts into the sea
A('<linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">'
  '<stop offset="0" stop-color="#04070D" stop-opacity="1"/>'
  '<stop offset="0.45" stop-color="#04070D" stop-opacity="0.62"/>'
  '<stop offset="0.75" stop-color="#04070D" stop-opacity="0.24"/>'
  '<stop offset="1" stop-color="#04070D" stop-opacity="0"/>'
  '</linearGradient>')
A('<radialGradient id="crestGlow" cx="0.5" cy="0.5" r="0.5">'
  '<stop offset="0" stop-color="#4E7089" stop-opacity="0.30"/>'
  '<stop offset="1" stop-color="#4E7089" stop-opacity="0"/></radialGradient>')
A('<radialGradient id="vignette" cx="0.5" cy="0.55" r="0.82">'
  '<stop offset="0.6" stop-color="#000" stop-opacity="0"/>'
  '<stop offset="1" stop-color="#000" stop-opacity="0.14"/>'
  '</radialGradient>')

for i, (pts, (c0, c1), tone, _, _) in enumerate(BANDS):
    if tone == "sand":
        a, b = SAND_SPAN[i]
        A(f'<linearGradient id="g{i}" x1="{a:.3f}" y1="0" x2="{b:.3f}" y2="0.10">'
          f'<stop offset="0" stop-color="{c1}"/>'
          f'<stop offset="0.22" stop-color="{c0}"/>'
          f'<stop offset="0.72" stop-color="{c0}"/>'
          f'<stop offset="1" stop-color="{c1}"/></linearGradient>')
    else:
        x2 = "1" if i % 2 == 0 else "0.8"
        A(f'<linearGradient id="g{i}" x1="0" y1="0" x2="{x2}" y2="0.35">'
          f'<stop offset="0" stop-color="{c0}"/>'
          f'<stop offset="0.55" stop-color="{c1}"/>'
          f'<stop offset="1" stop-color="{c0}"/></linearGradient>')

# crest paths kept as reusable defs -> ready for <textPath href="#crest-N">
for i, (pts, _, _, _, k) in enumerate(BANDS):
    A(f'<path id="crest-{i + 1}" d="{smooth(pts, k)}"/>')

A('<filter id="soften" filterUnits="userSpaceOnUse" x="-140" y="-60" width="1080" height="1960">'
  '<feGaussianBlur stdDeviation="24"/></filter>')

# one clip per ribbon, so the crest light stays inside its own band
for i, (pts, _, _, _, k) in enumerate(BANDS):
    d = smooth(pts, k) + f" L {pts[-1][0]:.1f},{H + 40} L {pts[0][0]:.1f},{H + 40} Z"
    A(f'<clipPath id="bandClip{i}"><path d="{d}"/></clipPath>')

A(f'<clipPath id="seaClip"><rect width="{W}" height="{H}"/></clipPath>')
A('</defs>')

# ------------------------------------------------------------------ canvas
A(f'<rect width="{W}" height="{H}" fill="#04070D"/>')
A('<ellipse cx="650" cy="770" rx="440" ry="310" fill="url(#crestGlow)"/>')

A('<g clip-path="url(#seaClip)">')

# ------------------------------------------------------------------- waves
for i, (pts, _, _, hair, k) in enumerate(BANDS):
    d_fill = smooth(pts, k) + f" L {pts[-1][0]:.1f},{H + 40} L {pts[0][0]:.1f},{H + 40} Z"
    A(f'<g filter="url(#paint{i % 2})">')
    A(f'<path d="{d_fill}" fill="url(#g{i})"/>')
    # light catching the crest, tucked inside this ribbon only
    A(f'<g clip-path="url(#bandClip{i})">'
      f'<use href="#crest-{i + 1}" fill="none" stroke="#BFD4E2" stroke-width="86" '
      f'stroke-opacity="0.13" filter="url(#soften)"/></g>')
    # hairline crest — this is the baseline a line of copy will sit on
    A(f'<use href="#crest-{i + 1}" fill="none" stroke="#E8DFCA" '
      f'stroke-width="2.4" stroke-opacity="{hair:.2f}" stroke-linecap="round"/>')
    A(f'<use href="#crest-{i + 1}" fill="none" stroke="#F6F1E4" '
      f'stroke-width="0.9" stroke-opacity="{hair * 0.45:.2f}"/>')
    A('</g>')

# black title block + soft fade into the water (before the paper pass, so the
# grain reads continuously across the seam)
A(f'<rect width="{W}" height="{TITLE_BOTTOM}" fill="#04070D"/>')
A(f'<rect y="{TITLE_BOTTOM}" width="{W}" height="{FADE}" fill="url(#haze)"/>')

# --------------------------------------------------------------- texturing
A(f'<rect width="{W}" height="{H}" filter="url(#bloom)" opacity="0.20" '
  f'style="mix-blend-mode:soft-light"/>')
A(f'<rect width="{W}" height="{H}" filter="url(#mottle)" opacity="0.20" '
  f'style="mix-blend-mode:soft-light"/>')
A(f'<rect width="{W}" height="{H}" filter="url(#grain)" opacity="0.09" '
  f'style="mix-blend-mode:overlay"/>')
A(f'<rect width="{W}" height="{H}" fill="url(#vignette)"/>')
A('</g>')
A('</svg>')

path = ("/Users/jenniferzhou/Documents/Adventure X/Hush-UnifiedInbox/"
        "design-references/poster/hush-poster-bg-80x180.svg")
with open(path, "w") as f:
    f.write("\n".join(out))
print(path)
