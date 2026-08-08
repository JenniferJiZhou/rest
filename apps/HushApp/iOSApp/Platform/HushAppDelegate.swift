import UIKit
import UserNotifications

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
        if userInfo["hush_entry"] as? String == "device_activity",
           let suggestion = Self.dynamicRestSuggestion(from: userInfo)
        {
            Task { @MainActor in
                NotificationCenter.default.post(
                    name: .hushDynamicRestSuggestionOpened,
                    object: suggestion
                )
                completionHandler()
            }
            return
        }

        guard
            userInfo[HushSleepScheduleController.routeUserInfoKey]
                as? String == HushSleepScheduleController.sleepRouteValue
        else {
            completionHandler()
            return
        }

        Task { @MainActor in
            HushSleepScheduleController.shared.requestSleepHandoff()
            completionHandler()
        }
    }

    private static func dynamicRestSuggestion(
        from userInfo: [AnyHashable: Any]
    ) -> HushDynamicRestSuggestion? {
        guard
            let requestID = userInfo["request_id"] as? String,
            let message = userInfo["message"] as? String,
            let title = userInfo["generated_task_title"] as? String,
            let durationNumber =
                userInfo["generated_task_duration_seconds"] as? NSNumber,
            let steps = userInfo["generated_task_steps"] as? [String]
        else {
            return nil
        }

        return HushDynamicRestSuggestion(
            requestID: requestID,
            message: message,
            generatedTask: GeneratedRestTask(
                title: title,
                durationSeconds: durationNumber.intValue,
                steps: steps
            )
        )
    }
}
