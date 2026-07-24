import Foundation
import UserNotifications

@MainActor
final class NotificationAuthorizationModel: ObservableObject {
    @Published private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined
    @Published private(set) var isRequestingAuthorization = false
    @Published private(set) var errorMessage: String?

    var isAuthorized: Bool {
        switch authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return true
        default:
            return false
        }
    }

    var statusMessage: String {
        switch authorizationStatus {
        case .authorized:
            return "休息提醒通知已启用"
        case .provisional, .ephemeral:
            return "休息提醒通知已临时启用"
        case .denied:
            return "休息提醒通知已关闭"
        case .notDetermined:
            return "尚未启用休息提醒通知"
        @unknown default:
            return "无法确认通知权限状态"
        }
    }

    func refreshStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        authorizationStatus = settings.authorizationStatus
    }

    func requestAuthorization() async {
        guard !isRequestingAuthorization else {
            return
        }

        isRequestingAuthorization = true
        errorMessage = nil

        defer {
            isRequestingAuthorization = false
        }

        do {
            _ = try await UNUserNotificationCenter.current().requestAuthorization(
                options: [.alert, .sound]
            )
            await refreshStatus()
        } catch {
            errorMessage = "无法申请通知权限，请稍后重试。"
        }
    }

    func sendTestReminder() async {
        await refreshStatus()

        guard isAuthorized else {
            errorMessage = "请先启用休息提醒通知。"
            return
        }

        let content = UNMutableNotificationContent()
        content.title = "Hush"
        content.body = "测试提醒已准备好。现在休息一下吗？"
        content.sound = .default
        content.userInfo = ["hush_entry": "notification_test"]

        let request = UNNotificationRequest(
            identifier: "hush.notification-test",
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        )

        do {
            try await UNUserNotificationCenter.current().add(request)
            errorMessage = nil
        } catch {
            errorMessage = "无法发送测试提醒，请检查通知设置后重试。"
        }
    }
}
