import AVFoundation
import SwiftUI

enum HushAmbientSound: String, CaseIterable, Identifiable {
    case whiteNoise
    case pinkNoise
    case brownNoise
    case rain

    var id: String { rawValue }

    var title: String {
        switch self {
        case .whiteNoise:
            "白噪音"
        case .pinkNoise:
            "粉红噪音"
        case .brownNoise:
            "棕色噪音"
        case .rain:
            "轻雨"
        }
    }

    fileprivate var resourceName: String {
        switch self {
        case .whiteNoise:
            "white-noise"
        case .pinkNoise:
            "pink-noise"
        case .brownNoise:
            "brown-noise"
        case .rain:
            "rain"
        }
    }
}

enum HushAmbientVolume: String, CaseIterable, Identifiable {
    case quiet
    case balanced
    case clear

    var id: String { rawValue }

    var title: String {
        switch self {
        case .quiet:
            "轻声"
        case .balanced:
            "平稳"
        case .clear:
            "清晰"
        }
    }

    fileprivate var value: Float {
        switch self {
        case .quiet:
            0.12
        case .balanced:
            0.2
        case .clear:
            0.32
        }
    }
}

@MainActor
final class HushAmbientAudioModel: ObservableObject {
    @Published var selectedSound: HushAmbientSound {
        didSet {
            defaults.set(selectedSound.rawValue, forKey: Self.soundKey)
            guard isPlaying else { return }
            startPlayback()
        }
    }

    @Published var volume: HushAmbientVolume {
        didSet {
            defaults.set(volume.rawValue, forKey: Self.volumeKey)
            player?.volume = volume.value
        }
    }

    @Published private(set) var isPlaying = false
    @Published private(set) var errorMessage: String?

    private static let soundKey = "hush.ambient.sound"
    private static let volumeKey = "hush.ambient.volume"

    private let defaults = UserDefaults.standard
    private var player: AVAudioPlayer?

    init() {
        selectedSound = HushAmbientSound(
            rawValue: defaults.string(forKey: Self.soundKey) ?? ""
        ) ?? .brownNoise
        volume = HushAmbientVolume(
            rawValue: defaults.string(forKey: Self.volumeKey) ?? ""
        ) ?? .balanced
    }

    func togglePlayback() {
        isPlaying ? stopPlayback() : startPlayback()
    }

    func stopPlayback() {
        player?.stop()
        player = nil
        isPlaying = false
        deactivateAudioSessionIfNeeded()
    }

    func clearError() {
        errorMessage = nil
    }

    private func startPlayback() {
        player?.stop()
        player = nil
        isPlaying = false
        errorMessage = nil

        guard
            let url = Bundle.main.url(
                forResource: selectedSound.resourceName,
                withExtension: "mp3"
            )
        else {
            errorMessage = "声音资源还没有加入当前 App Target。"
            return
        }

        do {
            try activateAudioSessionIfNeeded()
            let player = try AVAudioPlayer(contentsOf: url)
            player.numberOfLoops = -1
            player.volume = volume.value
            player.prepareToPlay()
            guard player.play() else {
                throw HushAmbientAudioError.playbackFailed
            }
            self.player = player
            isPlaying = true
        } catch {
            errorMessage = "暂时无法播放这个声音。"
            deactivateAudioSessionIfNeeded()
        }
    }

    private func activateAudioSessionIfNeeded() throws {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(
            .ambient,
            mode: .default,
            options: [.mixWithOthers]
        )
        try session.setActive(true)
        #endif
    }

    private func deactivateAudioSessionIfNeeded() {
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(
            false,
            options: [.notifyOthersOnDeactivation]
        )
        #endif
    }
}

private enum HushAmbientAudioError: Error {
    case playbackFailed
}

struct HushDoorView: View {
    @ObservedObject var ambientAudio: HushAmbientAudioModel

    let taskText: String
    let onOpenTask: () -> Void
    let onSettings: () -> Void
    var onOpenInbox: (() -> Void)?
    var onOpenCompanion: (() -> Void)?

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .topTrailing) {
                Button(action: onOpenTask) {
                    HushTypewriterText(text: taskText)
                        .frame(
                            width: min(290, geometry.size.width - 88),
                            alignment: .leading
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(taskText)
                .accessibilityHint("打开任务详情")
                .position(
                    x: geometry.size.width * 0.43,
                    y: geometry.size.height * 0.57
                )

                HStack(spacing: HushSpacing.xs) {
                    Menu {
                        Button(
                            ambientAudio.isPlaying
                                ? "停止播放"
                                : "开始播放"
                        ) {
                            ambientAudio.togglePlayback()
                        }

                        Divider()

                        Picker(
                            "陪伴声音",
                            selection: $ambientAudio.selectedSound
                        ) {
                            ForEach(HushAmbientSound.allCases) { sound in
                                Text(sound.title).tag(sound)
                            }
                        }

                        Picker(
                            "音量",
                            selection: $ambientAudio.volume
                        ) {
                            ForEach(HushAmbientVolume.allCases) { volume in
                                Text(volume.title).tag(volume)
                            }
                        }
                    } label: {
                        Image(
                            systemName: ambientAudio.isPlaying
                                ? "speaker.wave.2.fill"
                                : "speaker.slash"
                        )
                        .font(.system(size: 14, weight: .regular))
                        .foregroundStyle(
                            Color.white.opacity(
                                ambientAudio.isPlaying ? 0.9 : 0.68
                            )
                        )
                        .frame(width: 34, height: 34)
                        .background(
                            Circle().fill(Color.white.opacity(0.035))
                        )
                        .overlay(
                            Circle().stroke(
                                Color.white.opacity(
                                    ambientAudio.isPlaying ? 0.2 : 0.1
                                ),
                                lineWidth: 0.8
                            )
                        )
                    }
                    .accessibilityLabel(
                        ambientAudio.isPlaying
                            ? "陪伴声音正在播放"
                            : "选择陪伴声音"
                    )

                    if let onOpenCompanion {
                        Button(action: onOpenCompanion) {
                            Image(systemName: "sun.max.fill")
                                .font(.system(size: 14, weight: .regular))
                                .foregroundStyle(Color.white.opacity(0.82))
                                .frame(width: 34, height: 34)
                                .background(
                                    Circle().fill(Color.white.opacity(0.035))
                                )
                                .overlay(
                                    Circle().stroke(
                                        Color.white.opacity(0.12),
                                        lineWidth: 0.8
                                    )
                                )
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("打开常亮陪伴")
                    }

                    Button(action: onSettings) {
                        Image(systemName: "gearshape")
                            .font(.system(size: 15, weight: .regular))
                            .foregroundStyle(Color.white.opacity(0.78))
                            .frame(width: 34, height: 34)
                            .background(
                                Circle().fill(Color.white.opacity(0.035))
                            )
                            .overlay(
                                Circle().stroke(
                                    Color.white.opacity(0.12),
                                    lineWidth: 0.8
                                )
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("设置")
                }
                .padding(.top, HushSpacing.md)
                .padding(.trailing, HushSpacing.lg)

                if let onOpenInbox {
                    Button {
                        onOpenInbox()
                    } label: {
                        Image(systemName: "chevron.up")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(Color.white.opacity(0.32))
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .position(
                        x: geometry.size.width * 0.5,
                        y: geometry.size.height * 0.93
                    )
                    .accessibilityLabel("打开消息")
                    .accessibilityHint("点按或向上轻扫")
                }
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 18)
                    .onEnded { value in
                        guard let onOpenInbox else { return }
                        let vertical = value.translation.height
                        let horizontal = abs(value.translation.width)
                        if vertical < -52, abs(vertical) > horizontal {
                            onOpenInbox()
                        }
                    }
            )
        }
    }
}

private struct HushTypewriterText: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let text: String

    @State private var settledText = ""
    @State private var activeCharacter = ""
    @State private var activeOpacity = 0.0

    var body: some View {
        ZStack(alignment: .topLeading) {
            Text(text)
                .hidden()
                .accessibilityHidden(true)

            Text("\(Text(settledText))\(Text(activeCharacter).foregroundColor(Color.white.opacity(0.94 * activeOpacity)))")
        }
        .font(HushType.agentTask)
        .tracking(0.8)
        .lineSpacing(6)
        .foregroundStyle(Color.white.opacity(0.94))
        .multilineTextAlignment(.leading)
        .fixedSize(horizontal: false, vertical: true)
        .task(id: text) {
            await revealText()
        }
    }

    @MainActor
    private func revealText() async {
        settledText = ""
        activeCharacter = ""
        activeOpacity = 0

        guard !reduceMotion else {
            settledText = text
            return
        }

        do {
            try await Task.sleep(nanoseconds: 220_000_000)
        } catch {
            return
        }

        for character in text {
            guard !Task.isCancelled else { return }

            if character == "\n" {
                settledText.append(character)
                do {
                    try await Task.sleep(nanoseconds: 45_000_000)
                } catch {
                    return
                }
                continue
            }

            activeCharacter = String(character)
            activeOpacity = 0

            withAnimation(.easeOut(duration: 0.085)) {
                activeOpacity = 1
            }

            let cadence: UInt64
            switch character {
            case "，", "、":
                cadence = 125_000_000
            case "。", "！", "？":
                cadence = 180_000_000
            default:
                cadence = 72_000_000
            }

            do {
                try await Task.sleep(nanoseconds: cadence)
            } catch {
                return
            }

            settledText.append(character)
            activeCharacter = ""
            activeOpacity = 0
        }
    }
}
