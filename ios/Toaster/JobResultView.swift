import AVKit
import SwiftUI
import UniformTypeIdentifiers

/// 작업 결과 화면: 제목 · 상태 · 숫자 · 저장 버튼 · 파일 갤러리
struct JobResultView: View {
    let entry: JobEntry

    private enum Layout: String { case grid, list }
    @AppStorage("resultLayout") private var layout: Layout = .grid
    @State private var previewing: CollectedFile?
    @Environment(SaveFolder.self) private var folder
    @State private var pickingFolder = false
    @State private var pendingSave: JobModel.SaveTarget?
    /// 이미 저장한 곳에 또 저장하려 할 때 묻는다
    @State private var askingAgain: JobModel.SaveTarget?

    private var model: JobModel { entry.model }
    private var job: Job? { model.job }
    private var files: [CollectedFile] { job?.images ?? [] }
    private var videos: Int { files.filter(\.isVideo).count }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                if let job, job.status != .fetching, !(job.status == .failed && files.isEmpty) { stats }
                if entry.isRunning { progress }
                if let error = job?.error { ErrorRow(message: error).card() }
                if job?.status == .done, !files.isEmpty { actions }
                if !files.isEmpty { fileSection }
                if !model.stickerErrors.isEmpty { failedSection(model.stickerErrors, title: "스티커로 바꾸지 못한 파일") }
                if let errors = job?.errors, !errors.isEmpty { failedSection(errors, title: "받지 못한 파일") }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 32)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .background(Color.tBg)
        .navigationTitle(entry.displayTitle)
        .inlineNavigationTitle()
        .sheet(item: $previewing) { FilePreview(file: $0) }
        .alert(
            model.saveResult?.title ?? "",
            isPresented: Binding(get: { model.saveResult != nil }, set: { if !$0 { model.saveResult = nil } }),
            presenting: model.saveResult
        ) { _ in
            Button("확인", role: .cancel) {}
        } message: { result in
            Text(result.message)
        }
        .confirmationDialog(
            "이미 저장했습니다",
            isPresented: Binding(get: { askingAgain != nil }, set: { if !$0 { askingAgain = nil } }),
            titleVisibility: .visible, presenting: askingAgain
        ) { target in
            Button("한 번 더 저장") { perform(target) }
            Button("취소", role: .cancel) {}
        } message: { target in
            Text(target == .photos
                 ? "한 번 더 저장하면 사진 앱에 같은 사진이 또 들어갑니다."
                 : "한 번 더 저장하면 \(entry.folderName)_2 처럼 새 폴더를 만들어 또 저장합니다.")
        }
        .sensoryFeedback(.success, trigger: model.saved)
        #if DEBUG
        // 개발용: `-autoSave photos|folder` 로 실행하면 받기가 끝난 뒤 저장 버튼을 두 번 누른 것처럼 동작한다 (출시 빌드에는 없음)
        .task(id: job?.status == .done) {
            guard job?.status == .done, let raw = UserDefaults.standard.string(forKey: "autoSave") else { return }
            let target: JobModel.SaveTarget = raw == "photos" ? .photos : raw == "stickers" ? .stickers : .folder
            tap(target)
            tap(target)  // 저장 중 두 번째 누름은 무시돼야 한다
        }
        #endif
    }

    // MARK: 머리

    private var status: JobStatus { job?.status ?? .fetching }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                if entry.isRunning {
                    ProgressView().controlSize(.mini)
                } else {
                    Image(systemName: status == .failed ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
                }
                Text(status.label)
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(status == .failed ? Color.tDanger : status == .done ? Color.tOk : Color.tMuted)

            Text(entry.displayTitle)
                .font(.largeTitle.bold())
                .fixedSize(horizontal: false, vertical: true)
            if let job {
                Text(job.url)
                    .font(.footnote.monospaced())
                    .foregroundStyle(Color.tMuted)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
            }
        }
    }

    private var stats: some View {
        HStack(alignment: .top, spacing: 0) {
            Stat(label: "이미지", value: "\(files.count - videos)")
            Stat(label: "영상", value: "\(videos)")
            Stat(label: "용량", value: formatBytes(files.reduce(0) { $0 + $1.size }))
            if let errors = job?.errors, !errors.isEmpty {
                Stat(label: "못 받음", value: "\(errors.count)", tone: .tDanger)
            }
        }
        .card()
    }

    private var progress: some View {
        HStack(spacing: 12) {
            if let job, job.total > 0 {
                ProgressView(value: min(job.progress, Double(job.total)), total: Double(job.total))
                Text(job.stream.flatMap { $0.total > 0 ? "영상 조각 \($0.done) / \($0.total)" : nil }
                     ?? "\(job.processed) / \(job.total)")
                    .font(.footnote)
                    .monospacedDigit()
                    .foregroundStyle(Color.tMuted)
            } else {
                ProgressView().progressViewStyle(.linear)
            }
        }
        .tint(.tInk)
    }

    // MARK: 저장 버튼

    private var actions: some View {
        VStack(spacing: 12) {
            GlassEffectContainer(spacing: 10) {
                VStack(spacing: 10) {
                    saveButton(.folder)
                    saveButton(.stickers)
                    #if os(iOS)
                    saveButton(.photos)
                    #endif
                }
            }

            HStack(spacing: 6) {
                Image(systemName: "folder")
                Text(folder.url == nil ? "저장 폴더는 처음 저장할 때 고릅니다" : "저장 위치: \(folder.displayName)/\(entry.folderName)")
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 8)
                Button("바꾸기") {
                    pendingSave = nil
                    pickingFolder = true
                }
                .font(.footnote.weight(.semibold))
                .buttonStyle(.borderless)
                .disabled(model.saving != nil)
            }
            .font(.footnote)
            .foregroundStyle(Color.tMuted)
            .padding(.horizontal, 4)
        }
        .fileImporter(isPresented: $pickingFolder, allowedContentTypes: [.folder]) { result in
            let kind = pendingSave
            pendingSave = nil
            switch result {
            case .success(let url):
                do {
                    try folder.choose(url)
                    if let kind { perform(kind) }
                } catch {
                    model.saveResult = .init(ok: false, title: "폴더를 고르지 못했습니다", message: error.localizedDescription)
                }
            case .failure(let error):
                model.saveResult = .init(ok: false, title: "폴더를 고르지 못했습니다", message: error.localizedDescription)
            }
        }
    }

    @ViewBuilder
    private func saveButton(_ target: JobModel.SaveTarget) -> some View {
        let done = model.saved.contains(target)
        let button = Button { tap(target) } label: { saveLabel(target, done: done) }
            .disabled(model.saving != nil)
        // 주 동작(폴더에 저장)만 노란색. 저장을 마치면 투명으로 바뀌어 "됐다"가 보인다
        if target == .folder && !done {
            button.primaryGlassButton()
        } else {
            button.secondaryGlassButton()
        }
    }

    @ViewBuilder
    private func saveLabel(_ target: JobModel.SaveTarget, done: Bool) -> some View {
        if model.saving == target {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                if target == .stickers, let p = model.stickerProgress {
                    Text("스티커로 바꾸는 중 \(p.done)/\(p.total)").monospacedDigit()
                } else {
                    Text("저장하는 중…")
                }
            }
            .font(.headline)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 2)
        } else if done {
            WideLabel(title: target.doneTitle, systemImage: "checkmark.circle.fill")
        } else {
            WideLabel(title: target.title, systemImage: target.icon)
        }
    }

    private func tap(_ target: JobModel.SaveTarget) {
        guard model.saving == nil else { return }
        if model.saved.contains(target) {
            askingAgain = target
        } else {
            perform(target)
        }
    }

    /// 저장 폴더를 아직 안 골랐으면 먼저 고르게 하고, 고르면 이어서 저장한다.
    private func perform(_ target: JobModel.SaveTarget) {
        guard model.saving == nil else { return }
        if target != .photos, folder.url == nil {
            pendingSave = target
            pickingFolder = true
            return
        }
        switch target {
        case .folder: Task { await model.saveToFolder(folder, name: entry.folderName) }
        case .stickers: Task { await model.saveStickers(folder, name: entry.folderName) }
        case .photos:
            #if os(iOS)
            Task { await model.saveAllToPhotos() }
            #endif
        }
    }

    // MARK: 파일

    private var fileSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("파일 \(files.count)개").font(.title3.bold())
                Spacer()
                Picker("보기", selection: $layout) {
                    Image(systemName: "square.grid.2x2").accessibilityLabel("썸네일").tag(Layout.grid)
                    Image(systemName: "list.bullet").accessibilityLabel("목록").tag(Layout.list)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize()
            }
            if layout == .grid {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 10)], spacing: 10) {
                    ForEach(files) { file in
                        Button { previewing = file } label: { Tile(file: file) }
                            .buttonStyle(.plain)
                            .accessibilityLabel(file.filename)
                    }
                }
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(Array(files.enumerated()), id: \.element.id) { index, file in
                        if index > 0 { Divider().padding(.leading, 74) }
                        FileRow(file: file) { previewing = file }
                    }
                }
                .background(Color.tSurface, in: .rect(cornerRadius: 22, style: .continuous))
            }
        }
    }

    private func failedSection(_ errors: [String], title: String) -> some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(errors.enumerated()), id: \.offset) { _, error in
                    Text(error).font(.caption.monospaced()).foregroundStyle(Color.tMuted).textSelection(.enabled)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 8)
        } label: {
            Text("\(title) \(errors.count)개").font(.subheadline.weight(.medium)).foregroundStyle(Color.tInk)
        }
        .tint(.tInk)
        .card()
    }
}

extension JobModel.SaveTarget {
    var title: String {
        switch self {
        case .folder: "폴더에 저장"
        case .stickers: "텔레그램 스티커로 저장"
        case .photos: "사진 앱에 모두 저장"
        }
    }
    var doneTitle: String {
        switch self {
        case .folder: "폴더에 저장됨"
        case .stickers: "스티커로 저장됨"
        case .photos: "사진 앱에 저장됨"
        }
    }
    var icon: String {
        switch self {
        case .folder: "folder"
        case .stickers: "paperplane"
        case .photos: "photo.on.rectangle"
        }
    }
}

extension View {
    /// 둥근 흰 칸 (시스템 목록 칸과 같은 색·모서리)
    func card(padding: CGFloat = 16) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.tSurface, in: .rect(cornerRadius: 22, style: .continuous))
    }
}

// MARK: - 조각들

private struct Stat: View {
    let label: String
    let value: String
    var tone: Color = .tInk

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.footnote).foregroundStyle(Color.tMuted)
            Text(value).font(.title2.bold()).monospacedDigit().foregroundStyle(tone)
                .lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct Tile: View {
    let file: CollectedFile

    var body: some View {
        VStack(spacing: 0) {
            Thumbnail(file: file, inset: 10)
                .aspectRatio(1, contentMode: .fit)
            HStack(spacing: 4) {
                Text(file.filename).font(.system(size: 11, design: .monospaced)).lineLimit(1)
                Spacer(minLength: 0)
                Text(file.sizeText).font(.system(size: 10)).foregroundStyle(Color.tMuted)
            }
            .foregroundStyle(Color.tInk)
            .padding(.horizontal, 8)
            .frame(height: 30)
        }
        .background(Color.tSurface)
        .clipShape(.rect(cornerRadius: 16, style: .continuous))
    }
}

private struct FileRow: View {
    let file: CollectedFile
    let onTap: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Thumbnail(file: file, inset: 4)
                .frame(width: 48, height: 48)
                .clipShape(.rect(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(file.filename).font(.system(size: 14, design: .monospaced)).foregroundStyle(Color.tInk).lineLimit(1)
                Text("\(file.ext) · \(file.sizeText)").font(.system(size: 12)).foregroundStyle(Color.tMuted)
            }
            Spacer(minLength: 0)
            Menu {
                ShareLink(item: file.fileURL)
                Link(destination: file.sourceURL) { Label("원본 주소 열기", systemImage: "safari") }
                Button("원본 주소 복사", systemImage: "doc.on.doc") { copyToPasteboard(file.sourceURL.absoluteString) }
            } label: {
                Image(systemName: "ellipsis")
                    .foregroundStyle(Color.tMuted)
                    .frame(width: 44, height: 44)
                    .contentShape(.rect)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .contentShape(.rect)
        .onTapGesture(perform: onTap)
    }
}

private struct Thumbnail: View {
    let file: CollectedFile
    var inset: CGFloat = 6

    var body: some View {
        // 영상과 움직이는 그림은 소리 없이 끝없이 반복한다
        if file.isVideo {
            LoopingVideo(url: file.fileURL)
        } else {
            Checkerboard()
                .overlay { LocalImage(url: file.fileURL, isSVG: file.isSVG, side: 120, inset: inset) }
                .clipped()
        }
    }
}

private struct FilePreview: View {
    let file: CollectedFile
    @Environment(\.dismiss) private var dismiss
    @State private var looper: VideoLooper?

    var body: some View {
        NavigationStack {
            Group {
                if file.isVideo {
                    // 크게 볼 때는 소리를 켜고 조작 버튼을 보여 주되, 끝나면 처음부터 다시 돈다
                    VideoPlayer(player: looper?.player)
                        .onAppear {
                            if looper == nil { looper = VideoLooper(url: file.fileURL, muted: false) }
                            looper?.player.play()
                        }
                        .onDisappear { looper?.player.pause() }
                } else {
                    Checkerboard(cell: 12)
                        .overlay { LocalImage(url: file.fileURL, isSVG: file.isSVG, side: 400).padding(24) }
                }
            }
            .ignoresSafeArea(edges: .bottom)
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 0) {
                        Text(file.filename).font(.system(size: 15, weight: .semibold, design: .monospaced))
                        Text("\(file.ext) · \(file.sizeText)").font(.system(size: 11)).foregroundStyle(Color.tMuted)
                    }
                }
                ToolbarItem(placement: .cancellationAction) { Button("닫기", role: .close) { dismiss() } }
                ToolbarItem(placement: .primaryAction) { ShareLink(item: file.fileURL) }
            }
        }
    }
}
