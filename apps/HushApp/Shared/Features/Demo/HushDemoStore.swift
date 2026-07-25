import Combine
import Foundation
import SwiftUI

enum HushDemoRoute: Equatable {
    case door
    case checkIn
    case reflection
    case quest
    case session
    case feedback
    case completed
    case sleepHandoff
    case handoffRunning
    case pauseReceipt
    case blueReset
    case inbox
}

enum HushDemoPreference: String, CaseIterable, Identifiable {
    case quiet
    case move

    var id: String { rawValue }

    var title: String {
        switch self {
        case .quiet: return "安静一点"
        case .move: return "让身体动一下"
        }
    }
}

@MainActor
final class HushDemoStore: ObservableObject {
    @Published var route: HushDemoRoute = .door
    @Published var fatigueDescription = ""
    @Published var availableMinutes = 3
    @Published var selectedPreference: HushDemoPreference?
    @Published var selectedQuestIndex = 0
    @Published var openLoop = "明早确认路演材料的最终版本"
    @Published var includeGmail = true
    @Published var sleepTodaySummary = ""
    @Published var sleepHighlight = ""
    @Published var sleepTomorrowFirstStep = ""
    @Published private(set) var generatedRestTask: GeneratedRestTask?

    let content: HushDemoContentSnapshot
    private let manualRestProvider: (any HushManualRestTaskProviding)?

    init(
        provider: any HushRestContentProviding = BundledHushRestContentProvider.automatic,
        manualRestProvider: (any HushManualRestTaskProviding)? =
            HTTPManualRestTaskProvider.automatic,
        initialQuestID: String? = nil,
        initialGeneratedRestTask: GeneratedRestTask? = nil
    ) {
        content = HushDemoContentSnapshot.load(from: provider)
        self.manualRestProvider = manualRestProvider
        generatedRestTask = initialGeneratedRestTask
        if let initialQuestID,
           let initialIndex = content.quests.firstIndex(where: { $0.id == initialQuestID }) {
            selectedQuestIndex = initialIndex
        }
    }

    var currentQuest: HushQuestContent {
        if let generatedRestTask {
            return generatedRestTask.questContent
        }
        return content.quests[selectedQuestIndex % content.quests.count]
    }

    var currentDriftPrompt: HushDriftPrompt {
        content.driftPrompts.first ?? HushDriftPrompt(
            id: "fallback",
            category: "sense",
            text: "此刻房间里最远的声音是什么？"
        )
    }

    var currentBlueBoxCard: HushBlueBoxCard {
        content.blueBoxCards.first ?? .placeholder
    }

    func startCheckIn() {
        move(to: .checkIn)
    }

    func surpriseMe() {
        generatedRestTask = nil
        selectedPreference = nil
        selectFirstMatchingQuest(preference: nil)
        move(to: .quest)
    }

    func openCurrentQuest() {
        move(to: .quest)
    }

    func submitCheckIn() {
        if fatigueDescription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            fatigueDescription = "脑子很满，身体却停不下来"
        }
        move(to: .reflection)
    }

    func choosePreference(_ preference: HushDemoPreference) {
        generatedRestTask = nil
        selectedPreference = preference
        guard let manualRestProvider else {
            move(to: .door)
            return
        }
        NotificationCenter.default.post(
            name: .hushRestTaskGenerationStarted,
            object: nil
        )
        Task {
            defer {
                NotificationCenter.default.post(
                    name: .hushRestTaskGenerationFinished,
                    object: nil
                )
            }
            do {
                let suggestion = try await manualRestProvider.generateTask(
                    context: HushManualRestContext(
                        sessionID:
                            "session_manual_\(UUID().uuidString.lowercased())",
                        fatigueType: "unknown",
                        userPreference: preference.rawValue,
                        availableMinutes: availableMinutes,
                        source: Self.manualRestSource,
                        locationTags: []
                    )
                )
                generatedRestTask = suggestion.generatedTask
                move(to: .quest)
            } catch {
                generatedRestTask = nil
                move(to: .door)
            }
        }
    }

    func swapQuest() {
        generatedRestTask = nil
        guard content.quests.count > 1 else { return }
        selectedQuestIndex = (selectedQuestIndex + 1) % content.quests.count
    }

    func startSession() {
        move(to: .session)
    }

    func showFeedback() {
        move(to: .feedback)
    }

    func completeReset() {
        move(to: .completed)
    }

    func startSleepHandoff() {
        move(to: .sleepHandoff)
    }

    func submitHandoff() {
        move(to: .handoffRunning)
    }

    func showPauseReceipt() {
        move(to: .pauseReceipt)
    }

    func startBlueReset() {
        move(to: .blueReset)
    }

    func openInbox() {
        move(to: .inbox)
    }

    func closeInbox() {
        move(to: .door)
    }

    func finishSleepHandoff() {
        clearSleepDraft()
        move(to: .door)
    }

    func presentRestSuggestion(questID: String?) {
        generatedRestTask = nil
        if let questID,
           let index = content.quests.firstIndex(
               where: { $0.id == questID }
           )
        {
            selectedQuestIndex = index
        }
        move(to: .door)
    }

    func presentRestSuggestion(task: GeneratedRestTask) {
        generatedRestTask = task
        move(to: .door)
    }

    func clearGeneratedRestSuggestion() {
        generatedRestTask = nil
    }

    func remindAboutGeneratedRestSuggestionLater() {
        guard generatedRestTask != nil else { return }
        move(to: .door)
    }

    func dismissGeneratedRestSuggestion() {
        generatedRestTask = nil
        move(to: .door)
    }

    func reset() {
        fatigueDescription = ""
        selectedPreference = nil
        selectedQuestIndex = 0
        generatedRestTask = nil
        clearSleepDraft()
        route = .door
    }

    func goBack() {
        switch route {
        case .door:
            break
        case .checkIn, .quest, .pauseReceipt, .inbox:
            move(to: .door)
        case .sleepHandoff:
            clearSleepDraft()
            move(to: .inbox)
        case .reflection:
            move(to: .checkIn)
        case .session:
            move(to: .quest)
        case .feedback:
            move(to: .session)
        case .completed:
            move(to: .door)
        case .handoffRunning:
            move(to: .sleepHandoff)
        case .blueReset:
            move(to: .pauseReceipt)
        }
    }

    private func selectFirstMatchingQuest(preference: HushDemoPreference?) {
        let preferredEnergy = preference == .quiet ? "very_low" : "low"
        selectedQuestIndex = content.quests.firstIndex(where: { $0.energyRequired == preferredEnergy }) ?? 0
    }

    private static var manualRestSource: String {
        #if os(macOS)
        "manual_macos"
        #else
        "manual_ios"
        #endif
    }

    private func clearSleepDraft() {
        sleepTodaySummary = ""
        sleepHighlight = ""
        sleepTomorrowFirstStep = ""
    }

    private func move(to destination: HushDemoRoute) {
        withAnimation(.easeInOut(duration: 0.28)) {
            route = destination
        }
    }
}
