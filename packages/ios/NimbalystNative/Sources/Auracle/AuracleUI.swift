import SwiftUI

// Auracle iOS spine, M6 cutover — the app UI.
//
// A lean, engine-native flow that reuses the foundation (AuracleSession +
// EngineStore + AgentTurn): pair → sign in → browse strategies → chat with
// the agent / edit the source. SwiftUI-native throughout: the engine's mobile
// agent returns plain-text/markdown, so a native transcript is honest and
// simpler than the desktop-mirror's Lexical webview.

// MARK: - Root gate

public struct AuracleRootView: View {
    @EnvironmentObject private var session: AuracleSession

    public init() {}

    public var body: some View {
        Group {
            if !session.isPaired {
                AuraclePairView()
            } else if !session.isAuthenticated {
                AuracleSignInView()
            } else if let store = session.store {
                NavigationStack { StrategyListView(store: store) }
            } else {
                AuraclePairView()   // paired but store unbuilt — re-pair
            }
        }
        .preferredColorScheme(.dark)
        .tint(NimbalystColors.primary)
    }
}

// MARK: - Pairing

struct AuraclePairView: View {
    @EnvironmentObject private var session: AuracleSession
    @State private var showScanner = false
    @State private var manualURL = ""
    @State private var manualToken = ""

    var body: some View {
        ZStack {
            NimbalystColors.background.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 20) {
                    Image(systemName: "qrcode.viewfinder")
                        .font(.system(size: 52)).foregroundStyle(NimbalystColors.primary)
                        .padding(.top, 48)
                    Text("Pair with your engine")
                        .font(.title2.weight(.semibold))
                    Text("Open Auracle on your Mac, choose “Pair a phone,” and scan the code shown there.")
                        .font(.subheadline).foregroundStyle(NimbalystColors.textMuted)
                        .multilineTextAlignment(.center)

                    #if os(iOS)
                    Button { showScanner = true } label: {
                        Label("Scan QR code", systemImage: "camera.viewfinder").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent).tint(NimbalystColors.primary)
                    #endif

                    DisclosureGroup("Enter manually") {
                        VStack(spacing: 10) {
                            TextField("Engine address (http://…:1969)", text: $manualURL)
                                .textInputAutocapitalization(.never).autocorrectionDisabled()
                            TextField("Pairing code", text: $manualToken)
                                .textInputAutocapitalization(.never).autocorrectionDisabled()
                            Button("Pair") {
                                Task { await session.pairManual(engineURL: manualURL, token: manualToken) }
                            }
                            .buttonStyle(.bordered).frame(maxWidth: .infinity)
                        }
                        .textFieldStyle(.roundedBorder).padding(.top, 6)
                    }
                    .tint(NimbalystColors.textMuted)

                    if session.isPairing { ProgressView().tint(NimbalystColors.primary) }
                    if let e = session.pairError {
                        Text(e).font(.caption).foregroundStyle(NimbalystColors.error)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(32)
            }
        }
        .foregroundStyle(NimbalystColors.text)
        #if os(iOS)
        .sheet(isPresented: $showScanner) {
            ZStack(alignment: .top) {
                QRScannerView { scanned in
                    Task { @MainActor in await session.pair(qrPayload: scanned) }
                }
                .ignoresSafeArea()
                Text("Point at the code on your Mac")
                    .padding(10).background(.ultraThinMaterial, in: Capsule()).padding(.top, 60)
            }
            .onChange(of: session.isPaired) { _, paired in if paired { showScanner = false } }
        }
        #endif
    }
}

// MARK: - Sign in

struct AuracleSignInView: View {
    @EnvironmentObject private var session: AuracleSession

    var body: some View {
        ZStack {
            NimbalystColors.background.ignoresSafeArea()
            VStack(spacing: 20) {
                Spacer()
                Text("Auracle").font(.system(size: 44, weight: .semibold))
                Text("Sign in to your Auracle account")
                    .foregroundStyle(NimbalystColors.textMuted)

                if session.auth.isAuthenticating {
                    ProgressView().tint(NimbalystColors.primary).padding(.top, 8)
                } else {
                    Button { session.signIn() } label: {
                        Text("Sign in").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent).tint(NimbalystColors.primary)
                    .padding(.top, 8)
                }
                if let e = session.auth.authError {
                    Text(e).font(.caption).foregroundStyle(NimbalystColors.error)
                        .multilineTextAlignment(.center)
                }
                Spacer()
                Button("Unpair this engine", role: .destructive) { session.unpair() }
                    .font(.caption).tint(NimbalystColors.textMuted)
            }
            .padding(32)
            .foregroundStyle(NimbalystColors.text)
        }
    }
}

// MARK: - Strategy list

struct StrategyListView: View {
    @ObservedObject var store: EngineStore
    @EnvironmentObject private var session: AuracleSession

    var body: some View {
        List {
            if store.strategies.isEmpty {
                Section {
                    if store.isLoading {
                        HStack { ProgressView(); Text("Loading strategies…").foregroundStyle(NimbalystColors.textMuted) }
                    } else if let e = store.loadError {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Couldn't load strategies").font(.headline)
                            Text(e).font(.caption).foregroundStyle(NimbalystColors.textMuted)
                        }
                    } else {
                        Text("No strategies in your Auracle folder yet. Create one in the IDE and it'll show up here.")
                            .font(.subheadline).foregroundStyle(NimbalystColors.textMuted)
                    }
                }
                .listRowBackground(NimbalystColors.backgroundSecondary)
            }
            ForEach(store.strategies) { s in
                NavigationLink(value: s) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(s.code).font(.headline)
                        if !s.doc.isEmpty {
                            Text(s.doc).font(.caption).foregroundStyle(NimbalystColors.textMuted).lineLimit(2)
                        }
                    }
                    .padding(.vertical, 2)
                }
                .listRowBackground(NimbalystColors.backgroundSecondary)
            }
        }
        .scrollContentBackground(.hidden)
        .background(NimbalystColors.background.ignoresSafeArea())
        .navigationTitle("Strategies")
        .navigationDestination(for: MobileStrategy.self) { StrategyDetailView(store: store, strategy: $0) }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Sign out", action: session.signOut)
                    Button("Unpair", role: .destructive, action: session.unpair)
                } label: { Image(systemName: "person.crop.circle") }
            }
        }
        .refreshable { await store.refresh() }
        .task { await store.refresh() }
    }
}

// MARK: - Strategy detail (chat + source)

struct StrategyDetailView: View {
    let store: EngineStore
    let strategy: MobileStrategy
    @State private var tab = 0

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $tab) {
                Text("Chat").tag(0)
                Text("Source").tag(1)
            }
            .pickerStyle(.segmented)
            .padding(12)

            if tab == 0 {
                AgentChatView(store: store, strategy: strategy)
            } else {
                StrategySourceView(store: store, strategy: strategy)
            }
        }
        .background(NimbalystColors.background.ignoresSafeArea())
        .navigationTitle(strategy.code)
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct AgentChatView: View {
    let store: EngineStore
    let strategy: MobileStrategy
    @State private var messages: [AgentTranscriptMessage] = []
    @State private var input = ""
    @State private var isRunning = false

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if messages.isEmpty {
                            Text("Ask the Auracle Agent about \(strategy.code) — it can read the strategy's source.")
                                .font(.subheadline).foregroundStyle(NimbalystColors.textMuted)
                                .padding(.top, 40)
                        }
                        ForEach(messages) { MessageBubble(message: $0).id($0.id) }
                    }
                    .padding(16)
                }
                .onChange(of: messages) { _, _ in
                    if let last = messages.last {
                        withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
            }
            composeBar
        }
    }

    private var composeBar: some View {
        HStack(spacing: 8) {
            TextField("Message the agent…", text: $input, axis: .vertical)
                .textFieldStyle(.plain)
                .padding(10)
                .background(NimbalystColors.backgroundTertiary, in: RoundedRectangle(cornerRadius: 20))
                .lineLimit(1...5)
            Button { send() } label: {
                Image(systemName: "arrow.up.circle.fill").font(.system(size: 30))
            }
            .disabled(input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isRunning)
            .tint(NimbalystColors.primary)
        }
        .padding(12)
        .background(NimbalystColors.backgroundSecondary)
    }

    private func send() {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isRunning else { return }
        input = ""
        isRunning = true
        let stream = store.run(prompt: text, strategyCode: strategy.code)
        Task { @MainActor in
            defer { isRunning = false }
            do {
                for try await msg in stream { upsert(msg) }
            } catch {
                // A pre-stream failure the store didn't fold — surface it.
                upsert(AgentTranscriptMessage(
                    id: "err-\(messages.count)", role: "assistant",
                    text: EngineStore.friendlyMessage(for: error),
                    isComplete: true, isError: true))
            }
        }
    }

    private func upsert(_ m: AgentTranscriptMessage) {
        if let i = messages.firstIndex(where: { $0.id == m.id }) { messages[i] = m }
        else { messages.append(m) }
    }
}

struct MessageBubble: View {
    let message: AgentTranscriptMessage

    var body: some View {
        HStack {
            if message.role == "user" { Spacer(minLength: 44) }
            Group {
                if message.role == "assistant" && message.text.isEmpty && !message.isComplete {
                    ProgressView().tint(NimbalystColors.primary)
                } else {
                    Text(message.text)
                        .foregroundStyle(message.isError ? NimbalystColors.error : NimbalystColors.text)
                        .textSelection(.enabled)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(
                message.role == "user" ? NimbalystColors.primary.opacity(0.18) : NimbalystColors.backgroundTertiary,
                in: RoundedRectangle(cornerRadius: 14)
            )
            .frame(maxWidth: .infinity, alignment: message.role == "user" ? .trailing : .leading)
            if message.role != "user" { Spacer(minLength: 44) }
        }
    }
}

struct StrategySourceView: View {
    let store: EngineStore
    let strategy: MobileStrategy
    @State private var source = ""
    @State private var loaded = false
    @State private var isSaving = false
    @State private var status: String?

    var body: some View {
        VStack(spacing: 0) {
            if !loaded {
                Spacer(); ProgressView().tint(NimbalystColors.primary); Spacer()
            } else {
                TextEditor(text: $source)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(NimbalystColors.codeText)
                    .scrollContentBackground(.hidden)
                    .background(NimbalystColors.codeBackground)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                HStack {
                    if let status { Text(status).font(.caption).foregroundStyle(NimbalystColors.textMuted) }
                    Spacer()
                    Button { Task { await save() } } label: {
                        if isSaving { ProgressView() } else { Text("Save") }
                    }
                    .buttonStyle(.borderedProminent).tint(NimbalystColors.primary).disabled(isSaving)
                }
                .padding(12).background(NimbalystColors.backgroundSecondary)
            }
        }
        .task { await load() }
    }

    private func load() async {
        do { source = try await store.source(for: strategy.code) }
        catch { status = EngineStore.friendlyMessage(for: error) }
        loaded = true
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let r = try await store.save(code: strategy.code, source: source)
            status = "Saved · \(r.bytes) bytes"
        } catch {
            status = EngineStore.friendlyMessage(for: error)
        }
    }
}
