# Ambient Sounds Demo Handoff

Owner: M2 / P4 -> M1 / P1

## P4 delivery

The Hush Door now exposes a small speaker menu with four local ambient loops:

- white noise;
- pink noise;
- brown noise;
- light rain.

Playback is off by default and begins only after a user action. The selected
sound is stored locally. On iOS, playback uses the ambient audio-session
category, mixes with existing audio, and does not request background-audio
capability.

Source and public-domain records are in:

```text
content/ambient-sounds/README.md
```

## P1 Xcode resource step

M2 does not modify `project.pbxproj`. P1 should add these existing files to the
Hush Xcode project:

```text
content/ambient-sounds/white-noise.mp3
content/ambient-sounds/pink-noise.mp3
content/ambient-sounds/brown-noise.mp3
content/ambient-sounds/rain.mp3
```

Target membership:

```text
Hush
HushMac
```

Do not add them to:

```text
HushDeviceActivityMonitor
HushRestLiveActivity
```

Confirm all four files appear in **Build Phases -> Copy Bundle Resources** for
both App targets. Keep the final bundled resource names unchanged:

```text
white-noise.mp3
pink-noise.mp3
brown-noise.mp3
rain.mp3
```

No entitlement, Signing, Bundle ID, App Group, background mode, Swift Package,
Contract, networking, or backend change is required.

## Verification

1. Build the `HushMac` scheme and run it on My Mac.
2. Open the speaker menu on the Hush Door.
3. Confirm every sound starts, changes while playing, loops, and stops.
4. Confirm the app launches silently after a fresh start.
5. Build the `Hush` scheme and repeat on an iPhone.
6. Start other audio before Hush and confirm Hush mixes without taking over
   device playback.
7. Confirm leaving the Hush Door for another in-app route does not restart the
   sound.

If the App target does not contain the resource, Hush shows a local error
instead of attempting a network download.
