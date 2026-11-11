import SwiftUI

struct ContentView: View {
    @State private var store = JobStore()
    @State private var folder = SaveFolder()
    @State private var showingSettings = false
    @State private var mode: Mode = .kakao
    @State private var path: [String] = []

    // 입력값은 여기 두어 모드를 바꿔도 남게 한다
    @State private var kakaoInput = ""
    @State private var pageURL = ""
    @State private var selector = "img"
    @State private var render = false
    @State private var media: Media = .image

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    header

                    VStack(alignment: .leading, spacing: 22) {
                        PillSegmented(selection: $mode, options: Mode.allCases.map { ($0, $0.title) })
                        switch mode {
                        case .kakao: KakaoForm(input: $kakaoInput, onSubmit: startKakao)
                        case .general:
                            GeneralForm(pageURL: $pageURL, selector: $selector, render: $render, media: $media, onSubmit: startGeneral)
                        }
                    }
                    .card()

                    history

                    Text("받은 파일은 저작권자의 권리를 지켜 개인 용도로만 사용해 주세요.")
                        .font(.system(size: 12))
                        .foregroundStyle(Color.tMuted)
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 32)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color.tBg)
            .hiddenNavigationBar()
            .navigationDestination(for: String.self) { id in
                if let entry = store.entry(id) { JobResultView(entry: entry) }
            }
        }
        .tint(.tInk)
        .environment(folder)
        .sheet(isPresented: $showingSettings) { SettingsView().environment(folder) }
        #if os(macOS)
        .frame(minWidth: 520, minHeight: 640)
        #endif
        #if DEBUG
        // 개발용: `-autoKakao <끝주소>` 로 실행하면 바로 받기를 시작한다 (여러 기기 동시 테스트용, 출시 빌드에는 없음)
        .task {
            if let slug = UserDefaults.standard.string(forKey: "autoKakao"), store.entries.isEmpty {
                kakaoInput = slug
                startKakao(slug)
            }
        }
        #endif
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .lastTextBaseline, spacing: 3) {
                Text("toaster").font(.system(size: 34, weight: .heavy)).tracking(-1.4)
                Circle()
                    .fill(Color.tAccent)
                    .overlay { Circle().strokeBorder(Color.tInk.opacity(0.1)) }
                    .frame(width: 10, height: 10)
            }
            Text("이모티콘·이미지·영상 수집기").font(.system(size: 14)).foregroundStyle(Color.tMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .topTrailing) {
            Button { showingSettings = true } label: {
                Image(systemName: "gearshape")
                    .font(.system(size: 18))
                    .foregroundStyle(Color.tMuted)
                    .frame(width: 40, height: 40)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("설정")
        }
        .padding(.top, 4)
    }

    private var history: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("최근 작업").font(.system(size: 14, weight: .semibold)).foregroundStyle(Color.tMuted)
            if store.entries.isEmpty {
                Text("아직 작업이 없습니다. 위에서 링크를 붙여 넣고 받기를 눌러 보세요.")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.tMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card(padding: 18)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(store.entries.enumerated()), id: \.element.id) { index, entry in
                        if index > 0 { Divider().overlay(Color.tLine).padding(.leading, 48) }
                        NavigationLink(value: entry.id) { HistoryRow(entry: entry) }
                            .buttonStyle(.plain)
                    }
                }
                .card(padding: 4)
            }
        }
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
        let url = pageURL.trimmingCharacters(in: .whitespaces)
        let parsed = URL(string: url)
        let title = parsed.map { ($0.host() ?? url) + ($0.path() == "/" ? "" : $0.path()) } ?? url
        let entry = store.start(
            mode: .general, title: title,
            input: CollectInput(
                url: url, selector: selector.trimmingCharacters(in: .whitespaces), media: media, render: render
            ),
            folderName: parsed?.host() ?? "toaster"
        )
        path.append(entry.id)
    }
}

// MARK: - 카카오 이모티콘 입력

private struct KakaoForm: View {
    @Binding var input: String
    let onSubmit: (String) -> Void
    @State private var error: String?
    @FocusState private var focused: Bool

    private var preview: String? { Kakao.parseSlug(input) }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 8) {
                FieldLabel(text: "이모티콘 링크")
                HStack(spacing: 8) {
                    HStack(spacing: 6) {
                        TextField("공유 링크 또는 끝주소", text: $input)
                            .font(.system(size: 15))
                            .urlInput()
                            .submitLabel(.go)
                            .focused($focused)
                            .onSubmit(submit)
                            .onChange(of: input) { error = nil }
                        if preview != nil {
                            Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).foregroundStyle(Color.tOk)
                        }
                    }
                    .fieldChrome(focused: focused)
                    PasteLinkButton { text in
                        input = text
                        error = Kakao.parseSlug(text) == nil ? "복사한 내용이 이모티콘 링크가 아닙니다." : nil
                    }
                }
                Hint(text: preview.map { "\(Kakao.emoticonURL(slug: $0)) 에서 받습니다." }
                     ?? "카카오톡 이모티콘샵에서 공유 → 링크 복사 후 붙여넣기를 누르세요.")
            }

            if let error { ErrorBox(message: error) }

            Button("이모티콘 받기", action: submit)
                .buttonStyle(PrimaryButtonStyle())
                .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }

    private func submit() {
        guard let slug = Kakao.parseSlug(input) else {
            error = "이모티콘 링크 형식이 아닙니다. 카카오톡 이모티콘샵에서 공유한 링크를 넣어 주세요."
            return
        }
        focused = false
        onSubmit(slug)
    }
}

// MARK: - 일반 페이지 입력

private struct GeneralForm: View {
    @Binding var pageURL: String
    @Binding var selector: String
    @Binding var render: Bool
    @Binding var media: Media
    let onSubmit: () -> Void

    private enum Field { case url, selector }
    @FocusState private var focus: Field?

    private var valid: Bool {
        URL(string: pageURL)?.scheme?.hasPrefix("http") == true && !selector.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 8) {
                FieldLabel(text: "페이지 주소")
                HStack(spacing: 8) {
                    TextField("https://example.com/page", text: $pageURL)
                        .font(.system(size: 15))
                        .urlInput()
                        .focused($focus, equals: .url)
                        .fieldChrome(focused: focus == .url)
                    PasteLinkButton { pageURL = $0 }
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                FieldLabel(text: "찾을 요소")
                TextField("img.emoticon, div.thumb img", text: $selector)
                    .font(.system(size: 14, design: .monospaced))
                    .plainInput()
                    .focused($focus, equals: .selector)
                    .fieldChrome(focused: focus == .selector)
                Hint(text: "CSS 선택자입니다. 감싸는 요소를 고르면 안쪽 이미지·영상까지 찾습니다.")
            }
            VStack(alignment: .leading, spacing: 8) {
                FieldLabel(text: "받을 종류")
                PillSegmented(selection: $media, options: [(.image, "이미지"), (.video, "영상"), (.all, "둘 다")])
                if media != .image {
                    Hint(text: "영상은 직접 링크된 mp4·mov 등만 받습니다. 스트리밍(m3u8)이나 DRM 영상은 받을 수 없습니다.")
                }
            }
            Toggle(isOn: $render) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("자바스크립트로 그리는 페이지").font(.system(size: 14, weight: .medium)).foregroundStyle(Color.tInk)
                    Hint(text: "기기 안에서 페이지를 열어 끝까지 스크롤한 뒤 찾습니다. 느리지만 정확합니다.")
                }
            }
            .tint(.tOk)

            Button("가져오기") {
                focus = nil
                onSubmit()
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!valid)
        }
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
                    Circle().fill(entry.isFailed ? Color.tDanger : Color.tOk).frame(width: 8, height: 8)
                }
            }
            .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.displayTitle).font(.system(size: 15, weight: .medium)).foregroundStyle(Color.tInk).lineLimit(1)
                Text(entry.summary)
                    .font(.system(size: 13))
                    .foregroundStyle(entry.isFailed ? Color.tDanger : Color.tMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            TimelineView(.periodic(from: .now, by: 30)) { _ in
                Text(timeAgo(entry.startedAt))
            }
            .font(.system(size: 12))
            .foregroundStyle(Color.tMuted)
            Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Color.tLineStrong)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 12)
        .contentShape(.rect)
    }
}

private func timeAgo(_ date: Date) -> String {
    let s = Int(-date.timeIntervalSinceNow)
    if s < 60 { return "방금" }
    if s < 3600 { return "\(s / 60)분 전" }
    return "\(s / 3600)시간 전"
}

#Preview {
    ContentView()
}
