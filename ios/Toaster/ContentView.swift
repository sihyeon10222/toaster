import SwiftUI

struct ContentView: View {
    @AppStorage("apiURL") private var apiURL = ToasterAPI.defaultBaseURL

    var body: some View {
        // 탭을 바꿔도 진행 중인 작업이 사라지지 않게 각 탭이 자기 JobModel 을 갖는다
        TabView {
            KakaoEmoticonView(apiURL: $apiURL)
                .tabItem { Label("카카오 이모티콘", systemImage: "face.smiling") }
            GeneralPageView(apiURL: $apiURL)
                .tabItem { Label("일반 페이지", systemImage: "globe") }
        }
    }
}

private func makeAPI(_ apiURL: String) -> ToasterAPI? {
    URL(string: apiURL.trimmingCharacters(in: .whitespaces)).map(ToasterAPI.init(baseURL:))
}

/// 서버 설정 버튼과 시트
private struct SettingsToolbar: ViewModifier {
    @Binding var apiURL: String
    @State private var showSettings = false

    func body(content: Content) -> some View {
        content
            .toolbar {
                Button("서버 설정", systemImage: "gearshape") { showSettings = true }
            }
            .sheet(isPresented: $showSettings) {
                SettingsView(apiURL: $apiURL)
            }
    }
}

/// 카카오 이모티콘 탭: 링크 끝주소만 넣으면 이모티콘을 모아 <끝주소>.zip 으로 준다
private struct KakaoEmoticonView: View {
    @Binding var apiURL: String
    @State private var input = ""
    @State private var slug: String?
    @State private var inputError: String?
    @State private var model = JobModel()

    private var api: ToasterAPI? { makeAPI(apiURL) }
    private var preview: String? { Kakao.parseSlug(input) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 0) {
                        Text("e.kakao.com/t/")
                            .font(.body.monospaced())
                            .foregroundStyle(.secondary)
                        TextField("kakao-friends-classic", text: $input)
                            .font(.body.monospaced())
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .submitLabel(.go)
                            .onSubmit(submit)
                            .onChange(of: input) { inputError = nil }
                    }
                } header: {
                    Text("이모티콘 링크 또는 끝주소")
                } footer: {
                    if let preview {
                        Text("받을 페이지: \(Kakao.emoticonURL(slug: preview))")
                    } else {
                        Text("공유 링크를 통째로 붙여 넣어도 돼요.")
                    }
                }

                Section {
                    Button(action: submit) {
                        HStack {
                            Text(model.isRunning ? "이모티콘 굽는 중…" : "이모티콘 zip 받기").bold()
                            Spacer()
                            if model.isSubmitting || model.isRunning { ProgressView() }
                        }
                    }
                    .disabled(api == nil || input.trimmingCharacters(in: .whitespaces).isEmpty
                              || model.isSubmitting || model.isRunning)
                } footer: {
                    Text("이모티콘은 저작권이 있어요. 받은 파일은 개인 소장용으로만 써 주세요.")
                }

                if let inputError {
                    Section { Label(inputError, systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
                }
                if let message = model.errorMessage {
                    Section { Label(message, systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
                }

                if let job = model.job, let api {
                    ResultSection(job: job, model: model, api: api, zipLabel: slug.map { "\($0).zip 공유 / 파일에 저장" })
                }
            }
            .navigationTitle("🍞 Toaster")
            .modifier(SettingsToolbar(apiURL: $apiURL))
        }
    }

    private func submit() {
        guard let api, !model.isSubmitting, !model.isRunning else { return }
        guard let parsed = Kakao.parseSlug(input) else {
            inputError = "이모티콘 링크나 끝주소를 확인해 주세요. 예) kakao-friends-classic"
            return
        }
        inputError = nil
        slug = parsed
        Task {
            await model.start(
                api: api,
                url: Kakao.emoticonURL(slug: parsed),
                selector: Kakao.emoticonSelector,
                render: true,
                zipName: "\(parsed).zip"
            )
        }
    }
}

/// 일반 페이지 탭: 아무 페이지 주소와 CSS 선택자로 이미지를 모은다
private struct GeneralPageView: View {
    @Binding var apiURL: String
    @State private var pageURL = ""
    @State private var selector = "img"
    @State private var render = false
    @State private var model = JobModel()

    private var api: ToasterAPI? { makeAPI(apiURL) }

    private var canSubmit: Bool {
        api != nil && URL(string: pageURL)?.scheme?.hasPrefix("http") == true
            && !selector.trimmingCharacters(in: .whitespaces).isEmpty
            && !model.isSubmitting && !model.isRunning
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://example.com/page", text: $pageURL)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("img.emoticon, div.thumb img", text: $selector)
                        .font(.body.monospaced())
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Toggle("JS로 그려지는 페이지", isOn: $render)
                } header: {
                    Text("페이지 주소 · HTML 태그")
                } footer: {
                    Text("감싸는 요소를 지정하면 안쪽 이미지까지 찾아요.")
                }

                Section {
                    Button {
                        guard let api else { return }
                        Task {
                            await model.start(
                                api: api,
                                url: pageURL.trimmingCharacters(in: .whitespaces),
                                selector: selector.trimmingCharacters(in: .whitespaces),
                                render: render
                            )
                        }
                    } label: {
                        HStack {
                            Text(model.isRunning ? "굽는 중…" : "이미지 가져오기").bold()
                            Spacer()
                            if model.isSubmitting || model.isRunning { ProgressView() }
                        }
                    }
                    .disabled(!canSubmit)
                }

                if let message = model.errorMessage {
                    Section { Label(message, systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
                }

                if let job = model.job, let api {
                    ResultSection(job: job, model: model, api: api)
                }
            }
            .navigationTitle("🍞 Toaster")
            .modifier(SettingsToolbar(apiURL: $apiURL))
        }
    }
}

private struct ResultSection: View {
    let job: Job
    let model: JobModel
    let api: ToasterAPI
    var zipLabel: String? = nil

    private let columns = [GridItem(.adaptive(minimum: 96), spacing: 8)]

    var body: some View {
        Section {
            HStack {
                Text(job.status.label).bold()
                Spacer()
                if job.total > 0 {
                    Text("\(job.images.count)장 / 후보 \(job.total)개").foregroundStyle(.secondary)
                }
            }
            if !job.status.isFinished, job.total > 0 {
                ProgressView(value: Double(job.processed), total: Double(job.total))
            }
            if let error = job.error {
                Text(error).foregroundStyle(.red)
            }
            if job.status == .done {
                Button {
                    Task { await model.saveAllToPhotos(api: api) }
                } label: {
                    HStack {
                        Label("사진 앱에 모두 저장", systemImage: "photo.on.rectangle.angled")
                        Spacer()
                        if model.isSaving { ProgressView() }
                    }
                }
                .disabled(model.isSaving)
                if let zip = model.zipFileURL {
                    ShareLink(item: zip) { Label(zipLabel ?? "zip 공유 / 파일에 저장", systemImage: "square.and.arrow.up") }
                }
                if let message = model.saveMessage {
                    Text(message).font(.footnote).foregroundStyle(.secondary)
                }
            }
        } header: {
            Text("결과")
        }

        if !job.images.isEmpty {
            Section {
                LazyVGrid(columns: columns, spacing: 8) {
                    ForEach(job.images) { image in
                        AsyncImage(url: image.url) { phase in
                            switch phase {
                            case .success(let img): img.resizable().scaledToFit()
                            case .failure: Image(systemName: "photo").foregroundStyle(.secondary)
                            default: ProgressView()
                            }
                        }
                        .frame(height: 96)
                        .frame(maxWidth: .infinity)
                        .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 10))
                        .contextMenu {
                            ShareLink(item: image.url)
                            Text(image.filename)
                        }
                    }
                }
                .padding(.vertical, 4)
            }
        }

        if !job.errors.isEmpty {
            Section("받지 못한 이미지 \(job.errors.count)개") {
                ForEach(job.errors, id: \.self) { Text($0).font(.caption.monospaced()).foregroundStyle(.secondary) }
            }
        }
    }
}

private struct SettingsView: View {
    @Binding var apiURL: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("http://127.0.0.1:8000", text: $apiURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button("기본값으로") { apiURL = ToasterAPI.defaultBaseURL }
                } header: {
                    Text("toaster-server 주소")
                } footer: {
                    Text("시뮬레이터는 127.0.0.1, 실기기는 같은 Wi-Fi의 Mac IP(예: http://192.168.0.10:8000)나 배포 주소를 넣어요.")
                }
            }
            .navigationTitle("서버 설정")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("완료") { dismiss() } }
        }
    }
}

#Preview {
    ContentView()
}
