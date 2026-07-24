import FamilyControls
import Foundation

@MainActor
final class FamilyControlsAuthorizationModel: ObservableObject {
    @Published private(set) var authorizationStatus = AuthorizationCenter.shared.authorizationStatus
    @Published private(set) var isRequestingAuthorization = false
    @Published private(set) var errorMessage: String?

    var isAuthorized: Bool {
        if authorizationStatus == .approved {
            return true
        }

        if #available(iOS 26.4, *), authorizationStatus == .approvedWithDataAccess {
            return true
        }

        return false
    }

    var statusMessage: String {
        if isAuthorized {
            return "屏幕使用时间权限已启用"
        }

        if authorizationStatus == .denied {
            return "屏幕使用时间权限已拒绝"
        }

        return "尚未启用屏幕使用时间权限"
    }

    func refreshStatus() {
        authorizationStatus = AuthorizationCenter.shared.authorizationStatus
    }

    func requestAuthorization() async {
        guard !isRequestingAuthorization else {
            return
        }

        isRequestingAuthorization = true
        errorMessage = nil

        defer {
            isRequestingAuthorization = false
            refreshStatus()
        }

        do {
            try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
        } catch {
            errorMessage = "授权未完成，请稍后重试或检查“设置”中的屏幕使用时间权限。"
        }
    }
}
