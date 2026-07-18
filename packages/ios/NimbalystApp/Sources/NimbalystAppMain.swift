import SwiftUI
import NimbalystNative

#if canImport(UIKit)
/// AppDelegate adapter to receive APNs token callbacks.
/// SwiftUI @main apps do NOT get these callbacks without an explicit adapter.
class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        NotificationManager.shared.didRegisterForRemoteNotifications(withDeviceToken: deviceToken)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        NotificationManager.shared.didFailToRegisterForRemoteNotifications(withError: error)
    }
}
#endif

@main
struct NimbalystAppMain: App {
    #if canImport(UIKit)
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    #endif
    @Environment(\.scenePhase) private var scenePhase

    /// The engine-direct + Clerk app state (Auracle iOS spine, M6 cutover).
    @StateObject private var session = AuracleSession()

    var body: some Scene {
        WindowGroup {
            AuracleRootView()
                .environmentObject(session)
                .onOpenURL { url in session.handleDeepLink(url) }
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active { session.onForeground() }
        }
    }
}
