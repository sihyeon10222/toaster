import SwiftUI

struct ContentView: View {
    @State private var store = JobStore()
    @State private var folder = SaveFolder()
    @State private var showingSettings = false
    // 처음 보이는 탭은 왼쪽 첫 번째인 일반 페이지
    @State private var mode: Mode = .general
    @State private var path: [String] = []

    // 입력값은 여기 두어 모드를 바꿔도 남게 한다
    @State private var kakaoInput = ""
    @State private var pageURL = ""
    @State private var render = false
    @State private var media: Media = .all
    @State private var scan = PageScan()

    var body: some View {
        NavigationStack(path: $path) {
            Form {
                Section {
                    Picker("모드", selection: $mode) {
                        ForEach(Mode.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .controlSize(.large)
                }
                .bareRow()

                switch mode {
                case .kakao: KakaoForm(input: $kakaoInput, onSubmit: startKakao)
                case .general:
                    GeneralForm(pageURL: $pageURL, render: $render, media: $media, scan: scan, onSubmit: startGeneral)
                }

                history
            }
            .formStyle(.grouped)
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("toaster")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("설정", systemImage: "gearshape") { showingSettings = true }
                }
            }
            .navigationDestination(for: String.self) { id in
                if let entry = store.entry(id) {
                    JobResultView(entry: entry)
                } else {
                    ContentUnavailableView("지운 작업입니다", systemImage: "trash")
                }
            }
        }
        .tint(.tInk)
        .environment(folder)
        .sheet(isPresented: $showingSettings) {
            SettingsView(store: store, onReset: resetApp).environment(folder).tint(.tInk)
        }
        #if os(macOS)
        .frame(minWidth: 520, minHeight: 640)
        #endif
        #if DEBUG
        // 개발용: `-autoKakao <끝주소>` 로 실행하면 바로 받기를 시작한다 (출시 빌드에는 없음)
        .task {
            if let slug = UserDefaults.standard.string(forKey: "autoKakao"), store.entries.isEmpty {
                mode = .kakao
                kakaoInput = "https://e.kakao.com/t/\(slug)"
                startKakao(slug)
            }
            // `-autoPage <주소>` 는 일반 페이지 탭에 주소를 넣고 요소를 살펴본다
            if let page = UserDefaults.standard.string(forKey: "autoPage"), pageURL.isEmpty {
                mode = .general
                pageURL = page
                scan.scan(url: page, render: render, media: media) { media = $0 }
            }
        }
        #endif
    }

    private var history: some View {
        Section {
            if store.entries.isEmpty {
                Text("아직 작업이 없습니다. 위에서 링크를 넣고 받기를 눌러 보세요.")
                    .font(.subheadline)
                    .foregroundStyle(Color.tMuted)
            } else {
                ForEach(store.entries) { entry in
                    NavigationLink(value: entry.id) { HistoryRow(entry: entry) }
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button("삭제", systemImage: "trash", role: .destructive) { remove(entry.id) }
                        }
                        .contextMenu {
                            Button("삭제", systemImage: "trash", role: .destructive) { remove(entry.id) }
                        }
                }
            }
        } header: {
            Text("최근 작업")
        }
    }

    private func remove(_ id: String) {
        path.removeAll { $0 == id }
        withAnimation { store.remove(id) }
    }

    private func startKakao(_ slug: String) {
        let entry = store.start(
            mode: .kakao, title: slug,
            input: CollectInput(url: Kakao.emoticonURL(slug: slug), selector: Kakao.emoticonSelector),
            folderName: slug
        )
        path.append(entry.id)
    }

    private func startGeneral() {
        let url = pageURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let parsed = URL(string: url)
        let title = parsed.map { ($0.host() ?? url) + ($0.path() == "/" ? "" : $0.path()) } ?? url
        let entry = store.start(
            mode: .general, title: title,
            input: CollectInput(url: url, selector: scan.selector(for: media), media: media, render: render),
            folderName: Instagram.code(url).map { "instagram_\($0)" } ?? parsed?.host() ?? "toaster"
        )
        path.append(entry.id)
    }

    /// 앱 초기화: 기록·받아 둔 파일·캐시·설정을 모두 지우고 처음 화면으로
    private func resetApp() {
        store.removeAll()
        Housekeeping.clearEverything()
        if let bundle = Bundle.main.bundleIdentifier { UserDefaults.standard.removePersistentDomain(forName: bundle) }
        folder.reset()
        scan.reset()
        kakaoInput = ""
        pageURL = ""
        render = false
        media = .all
        mode = .general
        path = []
        showingSettings = false
    }
}

// MARK: - 카카오 이모티콘 입력

private struct KakaoForm: View {
    @Binding var input: String
    let onSubmit: (String) -> Void
    @State private var error: String?
    @FocusState private var focused: Bool

    private var slug: String? { Kakao.parseSlug(input) }

    var body: some View {
        Section {
            HStack(spacing: 10) {
                TextField("이모티콘 링크", text: $input, prompt: Text(Kakao.linkPlaceholder))
                    .labelsHidden()
                    .urlInput()
                    .submitLabel(.go)
                    .focused($focused)
                    .onSubmit(submit)
                    .onChange(of: input) { error = nil }
                if slug != nil {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(Color.tOk)
                        .transition(.scale.combined(with: .opacity))
                }
                PasteLinkButton(text: input) { text in
                    input = text
                    error = Kakao.parseSlug(text) == nil ? "복사한 내용이 https://e.kakao.com/ 이모티콘 링크가 아닙니다." : nil
                } onClear: {
                    input = ""
                    error = nil
                    focused = true
                }
            }
            .animation(.snappy, value: slug != nil)
            if let error { ErrorRow(message: error) }
        } header: {
            Text("이모티콘 링크")
        } footer: {
            Text(slug.map { "\(Kakao.emoticonURL(slug: $0)) 에서 받습니다." }
                 ?? "카카오톡 이모티콘샵에서 공유 → 링크 복사 후 붙여넣기 버튼을 누르세요.")
        }

        Section {
            Button(action: submit) { WideLabel(title: "이모티콘 받기") }
                .primaryGlassButton()
                .disabled(input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .bareRow()
    }

    private func submit() {
        guard let slug else {
            error = "https://e.kakao.com/ 으로 시작하는 이모티콘샵 링크만 받을 수 있습니다."
            return
        }
        focused = false
        onSubmit(slug)
    }
}

// MARK: - 일반 페이지 입력

private struct GeneralForm: View {
    @Binding var pageURL: String
    @Binding var render: Bool
    @Binding var media: Media
    let scan: PageScan
    let onSubmit: () -> Void

    @FocusState private var focused: Bool

    private var trimmed: String { pageURL.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var urlValid: Bool {
        guard let url = URL(string: trimmed) else { return false }
        return ["http", "https"].contains(url.scheme?.lowercased()) && url.host() != nil
    }
    private var needsScan: Bool { scan.needsScan(url: trimmed, render: render) }
    private var ready: Bool {
        urlValid && !scan.selector(for: media).isEmpty && (scan.manual || (!needsScan && scan.phase == .loaded))
    }

    var body: some View {
        Section {
            HStack(spacing: 10) {
                TextField("페이지 주소", text: $pageURL, prompt: Text("https://example.com/page"))
                    .labelsHidden()
                    .urlInput()
                    .submitLabel(.search)
                    .focused($focused)
                    .onSubmit(scanIfNeeded)
                PasteLinkButton(text: pageURL) { text in
                    pageURL = text
                    scanIfNeeded()
                } onClear: {
                    pageURL = ""
                    focused = true
                }
            }
            Toggle(isOn: $render) {
                Text("자바스크립트로 그리는 페이지")
                Text("기기 안에서 페이지를 열어 끝까지 스크롤한 뒤 찾습니다. 느리지만 정확합니다.")
            }
            .tint(.tOk)
            .onChange(of: render) {
                // 이미 살펴본 페이지면 바뀐 방식으로 다시 살펴본다
                if scan.phase != .idle, !scan.manual { scanIfNeeded() }
            }
        } header: {
            Text("페이지 주소")
        }

        Section {
            Picker("받을 종류", selection: $media) {
                Text("둘 다").tag(Media.all)
                Text("이미지").tag(Media.image)
                Text("영상").tag(Media.video)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
        } header: {
            Text("받을 종류")
        } footer: {
            if media != .image {
                Text("영상은 직접 링크된 mp4·mov 등만 받습니다. 스트리밍(m3u8)이나 DRM 영상은 받을 수 없습니다.")
            }
        }
        .onChange(of: media) { scan.fitSelection(to: media) }

        ElementPicker(scan: scan, media: media, canScan: urlValid, needsScan: needsScan, onScan: startScan)

        Section {
            Button {
                focused = false
                onSubmit()
            } label: {
                WideLabel(title: "가져오기")
            }
            .primaryGlassButton()
            .disabled(!ready)
        }
        .bareRow()
    }

    private func scanIfNeeded() {
        guard urlValid, needsScan, !scan.manual else { return }
        startScan()
    }

    private func startScan() {
        focused = false
        scan.scan(url: trimmed, render: render, media: media) { media = $0 }
    }
}

// MARK: - 최근 작업 한 줄

private struct HistoryRow: View {
    let entry: JobEntry

    var body: some View {
        HStack(spacing: 12) {
            Group {
                if entry.isRunning {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: entry.isFailed ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
                        .foregroundStyle(entry.isFailed ? Color.tDanger : Color.tOk)
                }
            }
            .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.displayTitle).font(.body).lineLimit(1)
                Text(entry.summary)
                    .font(.subheadline)
                    .foregroundStyle(entry.isFailed ? Color.tDanger : Color.tMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            TimelineView(.periodic(from: .now, by: 30)) { _ in
                Text(timeAgo(entry.startedAt))
            }
            .font(.footnote)
            .foregroundStyle(Color.tMuted)
        }
        .padding(.vertical, 2)
    }
}

private func timeAgo(_ date: Date) -> String {
    let s = Int(-date.timeIntervalSinceNow)
    if s < 60 { return "방금" }
    if s < 3600 { return "\(s / 60)분 전" }
    if s < 86400 { return "\(s / 3600)시간 전" }
    return "\(s / 86400)일 전"
}

#Preview {
    ContentView()
}
