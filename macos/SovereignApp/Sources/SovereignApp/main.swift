import AppKit
import Carbon
import Foundation
import WebKit

final class SovereignAppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow?
    private var webView: WKWebView?
    private var statusLabel: NSTextField?
    private var runtimeProcess: Process?
    private var runtimeReady = false
    private var pendingDeepLink: URL?

    private let identityURL = URL(string: "http://localhost:3000/identity")!

    override init() {
        super.init()
        NSAppleEventManager.shared().setEventHandler(
            self,
            andSelector: #selector(handleGetURLEvent(_:withReplyEvent:)),
            forEventClass: AEEventClass(kInternetEventClass),
            andEventID: AEEventID(kAEGetURL)
        )
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        createWindow()
        loadPlaceholder("Starting Meanly One...")

        probeRuntime { [weak self] isRunning in
            DispatchQueue.main.async {
                guard let self else { return }
                if !isRunning {
                    self.startRuntime()
                }
                self.waitForRuntime(attempt: 0)
            }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        runtimeProcess?.terminate()
    }

    @objc private func handleGetURLEvent(_ event: NSAppleEventDescriptor, withReplyEvent replyEvent: NSAppleEventDescriptor) {
        guard
            let rawURL = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue,
            let url = URL(string: rawURL)
        else {
            loadPlaceholder("Meanly One received an invalid sign-in link.")
            return
        }

        DispatchQueue.main.async { [weak self] in
            self?.handleDeepLink(url)
        }
    }

    private func createWindow() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.customUserAgent = "MeanlyOne/0.1 SovereignApp/0.1"
        webView.navigationDelegate = self
        self.webView = webView

        let statusLabel = NSTextField(labelWithString: "Starting local identity runtime...")
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.font = .systemFont(ofSize: 12, weight: .medium)
        self.statusLabel = statusLabel

        let contentView = NSView()
        contentView.addSubview(webView)
        contentView.addSubview(statusLabel)

        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            webView.topAnchor.constraint(equalTo: contentView.topAnchor),
            webView.bottomAnchor.constraint(equalTo: statusLabel.topAnchor, constant: -8),

            statusLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 14),
            statusLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -14),
            statusLabel.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -10),
            statusLabel.heightAnchor.constraint(equalToConstant: 18)
        ])

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1040, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Meanly One"
        window.center()
        window.contentView = contentView
        window.makeKeyAndOrderFront(nil)
        self.window = window

        NSApp.activate(ignoringOtherApps: true)
    }

    private func loadPlaceholder(_ message: String) {
        statusLabel?.stringValue = message
        let html = """
        <!doctype html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            :root { color-scheme: dark; }
            body {
              margin: 0;
              min-height: 100vh;
              display: grid;
              place-items: center;
              background: #080808;
              color: #f4f4f5;
              font: 650 16px -apple-system, BlinkMacSystemFont, "Inter", sans-serif;
            }
            main {
              width: min(520px, calc(100vw - 48px));
              border: 1px solid #28282b;
              border-radius: 24px;
              padding: 28px;
              background: linear-gradient(180deg, #121213, #0c0c0d);
              box-shadow: 0 28px 90px rgba(0,0,0,.55);
            }
            .brand {
              color: #8d8d93;
              font-size: 11px;
              font-weight: 850;
              letter-spacing: .1em;
              text-transform: uppercase;
            }
            h1 { margin: 10px 0 8px; font-size: 38px; letter-spacing: -.06em; }
            p { margin: 0; color: #8d8d93; line-height: 1.5; }
          </style>
        </head>
        <body>
          <main>
            <div class="brand">Meanly One</div>
            <h1>My Identity</h1>
            <p>\(Self.escapeHTML(message))</p>
          </main>
        </body>
        </html>
        """
        webView?.loadHTMLString(html, baseURL: nil)
    }

    private func startRuntime() {
        let repoRoot = Self.detectRepoRoot()
        let nodeDirectory = repoRoot.appendingPathComponent("node", isDirectory: true)
        let serverFile = nodeDirectory.appendingPathComponent("server.js")

        guard FileManager.default.fileExists(atPath: serverFile.path) else {
            loadPlaceholder("Could not find node/server.js. Launch from the simple-l1 checkout or set SIMPLE_L1_ROOT.")
            return
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["node", "server.js"]
        process.currentDirectoryURL = nodeDirectory
        process.environment = ProcessInfo.processInfo.environment.merging([
            "PORT": "3000",
            "NODE_NAME": "local-macos-app"
        ]) { _, new in new }

        let nullDevice = FileHandle(forWritingAtPath: "/dev/null")
        process.standardOutput = nullDevice
        process.standardError = nullDevice

        do {
            try process.run()
            runtimeProcess = process
            statusLabel?.stringValue = "Starting local identity runtime..."
        } catch {
            loadPlaceholder("Could not start the local identity runtime: \(error.localizedDescription)")
        }
    }

    private func waitForRuntime(attempt: Int) {
        probeRuntime { [weak self] isRunning in
            DispatchQueue.main.async {
                guard let self else { return }
                if isRunning {
                    self.runtimeReady = true
                    self.statusLabel?.stringValue = "Identity runtime ready on localhost:3000"
                    if let pendingDeepLink = self.pendingDeepLink {
                        self.pendingDeepLink = nil
                        self.openDeepLink(pendingDeepLink)
                    } else {
                        self.webView?.load(URLRequest(url: self.identityURL))
                    }
                    return
                }

                if attempt >= 50 {
                    self.runtimeReady = false
                    self.loadPlaceholder("The local identity runtime did not start. Run node/server.js manually and reopen the app.")
                    return
                }

                self.statusLabel?.stringValue = "Starting local identity runtime..."
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                    self.waitForRuntime(attempt: attempt + 1)
                }
            }
        }
    }

    private func probeRuntime(_ completion: @escaping (Bool) -> Void) {
        var request = URLRequest(url: identityURL)
        request.timeoutInterval = 0.8
        URLSession.shared.dataTask(with: request) { _, response, _ in
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            completion((200...499).contains(statusCode))
        }.resume()
    }

    private func handleDeepLink(_ url: URL) {
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)

        if !runtimeReady {
            pendingDeepLink = url
            loadPlaceholder("Opening Meanly sign-in request...")
            return
        }

        openDeepLink(url)
    }

    private func openDeepLink(_ url: URL) {
        guard String(url.scheme ?? "").lowercased() == "simplel1" else {
            loadPlaceholder("Unsupported sign-in link. Start again from the browser.")
            return
        }

        switch Self.deepLinkAction(url) {
        case "authorize":
            guard let authorizeURL = Self.localAuthorizeURL(from: url) else {
                loadPlaceholder("The Meanly sign-in link was malformed. Start again from the browser.")
                return
            }
            statusLabel?.stringValue = "Review this request in Meanly One."
            webView?.load(URLRequest(url: authorizeURL))
        case "identity-selected":
            loadPlaceholder("Identity approved. Return to the browser that started this request.")
        default:
            statusLabel?.stringValue = "Opening local identity home."
            webView?.load(URLRequest(url: identityURL))
        }
    }

    private static func detectRepoRoot() -> URL {
        let fileManager = FileManager.default
        let environment = ProcessInfo.processInfo.environment

        if let override = environment["SIMPLE_L1_ROOT"], !override.isEmpty {
            let url = URL(fileURLWithPath: override, isDirectory: true)
            if fileManager.fileExists(atPath: url.appendingPathComponent("node/server.js").path) {
                return url
            }
        }

        var candidates: [URL] = []
        var cursor = Bundle.main.bundleURL
        for _ in 0..<6 {
            cursor.deleteLastPathComponent()
            candidates.append(cursor)
        }
        candidates.append(URL(fileURLWithPath: fileManager.currentDirectoryPath, isDirectory: true))

        for candidate in candidates {
            if fileManager.fileExists(atPath: candidate.appendingPathComponent("node/server.js").path) {
                return candidate
            }
        }

        return URL(fileURLWithPath: fileManager.currentDirectoryPath, isDirectory: true)
    }

    private static func deepLinkAction(_ url: URL) -> String {
        if let host = url.host, !host.isEmpty {
            return host.lowercased()
        }

        return url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")).lowercased()
    }

    private static func localAuthorizeURL(from url: URL) -> URL? {
        guard let incoming = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return nil
        }

        var local = URLComponents()
        local.scheme = "http"
        local.host = "localhost"
        local.port = 3000
        local.path = "/authorize"
        local.queryItems = incoming.queryItems

        return local.url
    }

    private static func escapeHTML(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&#039;")
    }

    // MARK: - WKNavigationDelegate

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if let url = navigationAction.request.url, String(url.scheme ?? "").lowercased() == "simplel1" {
            decisionHandler(.cancel)
            handleDeepLink(url)
            return
        }
        decisionHandler(.allow)
    }
}

let app = NSApplication.shared
let delegate = SovereignAppDelegate()
app.delegate = delegate
app.run()
