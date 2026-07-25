import UIKit
import UserNotifications

struct HushIOSRestSuggestion: Codable, Equatable {
    let requestID: String
    let message: String
    let questID: String?
}

extension Notification.Name {
    static let hushIOSRestSuggestionOpened = Notification.Name(
        "hush.ios.rest-suggestion-opened"
    )
}

enum HushIOSRestSuggestionRouting {
    static let routeUserInfoKey = "hush_route"
    static let restRouteValue = "rest_suggestion"
    static let requestIDKey = "request_id"
    static let messageKey = "message"
    static let questIDKey = "quest_id"

    private static let storedSuggestionKey =
        "ios.notifications.lastOpenedRestSuggestion"

    static func userInfo(
        for suggestion: HushIOSRestSuggestion
    ) -> [AnyHashable: Any] {
        [
            routeUserInfoKey: restRouteValue,
            requestIDKey: suggestion.requestID,
            messageKey: suggestion.message,
            questIDKey: suggestion.questID ?? ""
        ]
    }

    static func suggestion(
        from userInfo: [AnyHashable: Any]
    ) -> HushIOSRestSuggestion? {
        guard
            userInfo[routeUserInfoKey] as? String == restRouteValue,
            let requestID = userInfo[requestIDKey] as? String
        else {
            return nil
        }

        let rawQuestID = userInfo[questIDKey] as? String
        return HushIOSRestSuggestion(
            requestID: requestID,
            message: userInfo[messageKey] as? String ?? "",
            questID: rawQuestID?.isEmpty == false ? rawQuestID : nil
        )
    }

    static func store(_ suggestion: HushIOSRestSuggestion) {
        guard let data = try? JSONEncoder().encode(suggestion) else {
            return
        }
        UserDefaults.standard.set(data, forKey: storedSuggestionKey)
    }

    static func lastOpenedSuggestion() -> HushIOSRestSuggestion? {
        guard
            let data = UserDefaults.standard.data(
                forKey: storedSuggestionKey
            )
        else {
            return nil
        }
        return try? JSONDecoder().decode(
            HushIOSRestSuggestion.self,
            from: data
        )
    }
}

final class HushAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [
            UIApplication.LaunchOptionsKey: Any
        ]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (
            UNNotificationPresentationOptions
        ) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        if userInfo[HushSleepScheduleController.routeUserInfoKey]
            as? String == HushSleepScheduleController.sleepRouteValue
        {
            Task { @MainActor in
                HushSleepScheduleController.shared.requestSleepHandoff()
                completionHandler()
            }
            return
        }

        if let suggestion = HushIOSRestSuggestionRouting.suggestion(
            from: userInfo
        ) {
            HushIOSRestSuggestionRouting.store(suggestion)
            DispatchQueue.main.async {
                NotificationCenter.default.post(
                    name: .hushIOSRestSuggestionOpened,
                    object: suggestion
                )
                completionHandler()
            }
            return
        }

        DispatchQueue.main.async {
            completionHandler()
        }
    }
}
