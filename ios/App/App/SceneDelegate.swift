import UIKit
import Capacitor

/// UIScene lifecycle（iOS 27 SDK 起為必要：以新版 SDK 建置、未採用 scene lifecycle 的 App
/// 會在啟動時被 UIKit 以 _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption 中止）。
///
/// window 由 Info.plist 的 UISceneStoryboardFile（Main → CAPBridgeViewController）建立。
/// 採用 scene 後 UIKit 不再呼叫 AppDelegate 的 application(_:open:options:) 與
/// application(_:continue:restorationHandler:)，改由這裡收到 URL／user activity，
/// 轉交給同一個 Capacitor ApplicationDelegateProxy（App plugin 的 appUrlOpen、
/// getLaunchUrl 都依賴它，例如 oxm://oauth/callback）。
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard scene is UIWindowScene else { return }
        // 冷啟動：App 由 URL 或 user activity 開啟時，資料在 connectionOptions 內
        for context in connectionOptions.urlContexts {
            forward(context)
        }
        for activity in connectionOptions.userActivities {
            forward(activity)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            forward(context)
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        forward(userActivity)
    }

    private func forward(_ context: UIOpenURLContext) {
        var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
        if let source = context.options.sourceApplication {
            options[.sourceApplication] = source
        }
        if let annotation = context.options.annotation {
            options[.annotation] = annotation
        }
        options[.openInPlace] = context.options.openInPlace
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: options)
    }

    private func forward(_ userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }
}
