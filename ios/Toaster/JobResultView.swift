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
    @State private var pendingSave: SaveKind?

    private var model: JobModel { entry.model }
    private var job: Job? { model.job }
    private var files: [CollectedFile] { job?.images ?? [] }
    private var videos: Int { files.filter(\.isVideo).count }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header
                if let job, job.status != .fetching { stats }
                if entry.isRunning { progress }
                if let error = job?.error { ErrorBox(message: error) }
                if job?.status == .done { actions }
                files.isEmpty ? nil : fileSection
                if !model.stickerErrors.isEmpty { failedSection(model.stickerErrors, title: "스티커로 바꾸지 못한 파일") }
                if let errors = job?.errors, !errors.isEmpty { failedSection(errors, title: "받지 못한 파일") }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 32)
        }
        .background(Color.tBg)
        .inlineNavigationTitle()
        .sheet(item: $previewing) { FilePreview(file: $0) }
    }

    // MARK: 머리

    private var status: JobStatus { job?.status ?? .fetching }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            StatusPill(label: status.label, colors: status.colors, spinning: entry.isRunning)
            Text(entry.displayTitle)
                .font(.system(size: 28, weight: .bold))
                .tracking(-0.9)
                .foregroundStyle(Color.tInk)
                .fixedSize(horizontal: false, vertical: true)
            if let job {
                Text(job.url)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(Color.tMuted)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
    }

    private var stats: some View {
        HStack(alignment: .top, spacing: 28) {
            Stat(label: "이미지", value: "\(files.count - videos)")
            Stat(label: "영상", value: "\(videos)")
            Stat(label: "용량", value: formatBytes(files.reduce(0) { $0 + $1.size }))
            if let errors = job?.errors, !errors.isEmpty {
                Stat(label: "못 받음", value: "\(errors.count)", tone: .tDanger)
            }
        }
    }

    private var progress: some View {
        HStack(spacing: 12) {
            if let job, job.total > 0 {
                ProgressView(value: Double(job.processed), total: Double(job.total)).tint(.tInk)
                Text("\(job.processed) / \(job.total)")
                    .font(.system(size: 13))
                    .monospacedDigit()
                    .foregroundStyle(Color.tMuted)
            } else {
                ProgressView().progressViewStyle(.linear).tint(.tInk)
            }
        }
    }

    // MARK: 저장 버튼

    private var actions: some View {
        VStack(spacing: 10) {
            Button { save(.files) } label: {
                Label("폴더에 저장", systemImage: "folder")
            }
            .buttonStyle(PrimaryButtonStyle())

            Button { save(.stickers) } label: {
                if let p = model.stickerProgress {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("스티커로 바꾸는 중 \(p.done)/\(p.total)").monospacedDigit()
                    }
                } else {
                    Label("텔레그램 스티커로 저장", systemImage: "paperplane")
                }
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(model.stickerProgress != nil)

            #if os(iOS)
            Button {
                Task { await model.saveAllToPhotos() }
            } label: {
                if model.isSaving {
                    ProgressView().controlSize(.small)
                } else {
                    Label("사진 앱에 모두 저장", systemImage: "photo.on.rectangle")
                }
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(model.isSaving)
            #endif

            HStack(spacing: 6) {
                Image(systemName: "folder").font(.system(size: 12))
                Text(folder.url == nil ? "저장 폴더는 처음 저장할 때 고릅니다" : "저장 위치: \(folder.displayName)/\(entry.folderName)")
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 8)
                Button("바꾸기") {
                    pendingSave = nil
                    pickingFolder = true
                }
                .font(.system(size: 13, weight: .semibold))
                .buttonStyle(.plain)
                .foregroundStyle(Color.tInk)
            }
            .font(.system(size: 13))
            .foregroundStyle(Color.tMuted)
            .padding(.top, 2)

            if let message = model.saveMessage {
                Hint(text: message).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .fileImporter(isPresented: $pickingFolder, allowedContentTypes: [.folder]) { result in
            switch result {
            case .success(let url):
                do {
                    try folder.choose(url)
                    if let kind = pendingSave { save(kind) }
                } catch {
                    model.saveMessage = "폴더를 기억하지 못했습니다: \(error.localizedDescription)"
                }
            case .failure(let error):
                model.saveMessage = error.localizedDescription
            }
            pendingSave = nil
        }
    }

    private enum SaveKind { case files, stickers }

    /// 저장 폴더를 아직 안 골랐으면 먼저 고르게 하고, 고르면 이어서 저장한다.
    private func save(_ kind: SaveKind) {
        guard folder.url != nil else {
            pendingSave = kind
            pickingFolder = true
            return
        }
        switch kind {
        case .files: model.saveToFolder(folder, name: entry.folderName)
        case .stickers: Task { await model.saveStickers(folder, name: entry.folderName) }
        }
    }

    // MARK: 파일

    private var fileSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("파일 ").font(.system(size: 16, weight: .semibold))
                    + Text("\(files.count)").font(.system(size: 16, weight: .semibold)).foregroundColor(.tMuted)
                Spacer()
                PillSegmented(selection: $layout, options: [(.grid, "썸네일"), (.list, "목록")], compact: true)
                    .frame(width: 150)
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
                VStack(spacing: 0) {
                    ForEach(Array(files.enumerated()), id: \.element.id) { index, file in
                        if index > 0 { Divider().overlay(Color.tLine).padding(.leading, 76) }
                        FileRow(file: file) { previewing = file }
                    }
                }
                .card(padding: 0)
            }
        }
    }

    private func failedSection(_ errors: [String], title: String) -> some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(errors, id: \.self) {
                    Text($0).font(.system(size: 11, design: .monospaced)).foregroundStyle(Color.tMuted)
                }
            }
            .padding(.top, 8)
        } label: {
            Text("\(title) \(errors.count)개").font(.system(size: 14, weight: .medium)).foregroundStyle(Color.tInk)
        }
        .card(padding: 16)
    }
}

// MARK: - 조각들

private struct Stat: View {
    let label: String
    let value: String
    var tone: Color = .tInk

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 13)).foregroundStyle(Color.tMuted)
            Text(value).font(.system(size: 22, weight: .bold)).tracking(-0.6).monospacedDigit().foregroundStyle(tone)
        }
    }
}

private struct Tile: View {
    let file: CollectedFile

    var body: some View {
        VStack(spacing: 0) {
            Thumbnail(file: file, inset: 10)
                .aspectRatio(1, contentMode: .fit)
            Divider().overlay(Color.tLine)
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
        .clipShape(.rect(cornerRadius: 14, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.tLine) }
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
                .overlay { RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color.tLine) }
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
                    .frame(width: 36, height: 36)
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
                ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } }
                ToolbarItem(placement: .primaryAction) { ShareLink(item: file.fileURL) }
            }
        }
        .tint(.tInk)
    }
}
