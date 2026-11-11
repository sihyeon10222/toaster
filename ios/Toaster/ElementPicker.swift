import SwiftUI

/// 일반 페이지의 "찾을 요소": 페이지를 먼저 훑어 이미지·영상 묶음을 보여 주고 거기서 고르게 한다.
/// CSS 선택자를 모르는 사람도 미리보기를 보고 고를 수 있다. 아는 사람은 직접 입력해도 된다.
@MainActor
@Observable
final class PageScan {
    enum Phase: Equatable {
        case idle, loading, loaded
        case failed(String)
    }

    private(set) var phase: Phase = .idle
    private(set) var groups: [ElementGroup] = []
    /// 넘겨 주기 뒤 실제 페이지 주소 (미리보기를 받을 때 Referer 로 쓴다)
    private(set) var pageURL: URL?
    var selected: Set<String> = []
    /// 목록 대신 CSS 선택자를 직접 넣는다
    var manual = false
    var manualSelector = ""

    private var key: String?
    private var task: Task<Void, Never>?

    /// 지금 주소·렌더링 설정으로 아직 훑어보지 않았다
    func needsScan(url: String, render: Bool) -> Bool { key != Self.key(url, render) }

    func scan(url: String, render: Bool, media: Media) {
        task?.cancel()
        let key = Self.key(url, render)
        self.key = key
        phase = .loading
        groups = []
        selected = []
        task = Task {
            do {
                let (html, finalURL) = try await Collector.loadPage(url, render: render)
                let found = try await Task.detached { try Collector.scanElements(html: html, pageURL: finalURL) }.value
                guard self.key == key else { return }
                groups = found
                pageURL = finalURL
                phase = found.isEmpty
                    ? .failed(render
                        ? "이 페이지에서 이미지·영상을 찾지 못했습니다."
                        : "이미지·영상을 찾지 못했습니다. 자바스크립트로 그리는 페이지라면 위 스위치를 켜고 다시 살펴보세요.")
                    : .loaded
                fitSelection(to: media)
            } catch {
                guard self.key == key, !Task.isCancelled else { return }
                phase = .failed(error.localizedDescription)
            }
        }
    }

    func reset() {
        task?.cancel()
        key = nil
        phase = .idle
        groups = []
        selected = []
        manual = false
        manualSelector = ""
    }

    func visible(_ media: Media) -> [ElementGroup] {
        groups.filter { media == .all || $0.isVideo == (media == .video) }
    }

    /// 받을 종류를 바꾸면 안 보이게 된 묶음은 빼고, 아무것도 안 골랐으면 가장 그럴듯한 묶음을 고른다.
    func fitSelection(to media: Media) {
        let ids = Set(visible(media).map(\.id))
        selected.formIntersection(ids)
        guard selected.isEmpty else { return }
        // 페이지 본문은 보통 가장 많이 반복되는 묶음이다. 없으면 "모든 이미지/영상"
        let list = visible(media)
        if let best = list.first(where: { !$0.isEverything && $0.count > 1 }) ?? list.first {
            selected = [best.id]
        }
    }

    func toggle(_ group: ElementGroup) {
        if selected.contains(group.id) { selected.remove(group.id) } else { selected.insert(group.id) }
    }

    /// 받기에 넘길 선택자. 여러 묶음을 고르면 쉼표로 잇는다.
    func selector(for media: Media) -> String {
        if manual { return manualSelector.trimmingCharacters(in: .whitespaces) }
        return visible(media).filter { selected.contains($0.id) }.map(\.selector).joined(separator: ", ")
    }

    private static func key(_ url: String, _ render: Bool) -> String {
        "\(render)|\(url.trimmingCharacters(in: .whitespaces))"
    }
}

// MARK: - 화면

struct ElementPicker: View {
    let scan: PageScan
    let media: Media
    let canScan: Bool
    let needsScan: Bool
    let onScan: () -> Void

    @State private var showAll = false
    @FocusState private var focused: Bool
    private let collapsedCount = 5

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                FieldLabel(text: "찾을 요소")
                Spacer()
                Button(scan.manual ? "목록에서 고르기" : "직접 입력") {
                    withAnimation(.snappy(duration: 0.2)) { scan.manual.toggle() }
                }
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.tMuted)
                .buttonStyle(.plain)
            }
            if scan.manual { manualField } else { list }
        }
    }

    private var manualField: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("img.emoticon, div.thumb img", text: Bindable(scan).manualSelector)
                .font(.system(size: 14, design: .monospaced))
                .plainInput()
                .focused($focused)
                .fieldChrome(focused: focused)
            Hint(text: "CSS 선택자입니다. 감싸는 요소를 고르면 안쪽 이미지·영상까지 찾습니다.")
        }
    }

    @ViewBuilder
    private var list: some View {
        if !canScan {
            Hint(text: "페이지 주소를 넣으면 그 페이지에 있는 이미지·영상을 묶음으로 보여 줍니다. 받을 묶음을 고르세요.")
        } else if needsScan {
            Button(action: onScan) {
                Label("페이지 살펴보기", systemImage: "magnifyingglass")
            }
            .buttonStyle(SecondaryButtonStyle())
            Hint(text: "페이지에 어떤 이미지·영상이 있는지 먼저 보여 드립니다.")
        } else {
            switch scan.phase {
            case .idle, .loading:
                HStack(spacing: 10) {
                    ProgressView().controlSize(.small)
                    Text("페이지를 살펴보는 중").font(.system(size: 14)).foregroundStyle(Color.tMuted)
                }
                .frame(maxWidth: .infinity, minHeight: 64)
                .background(Color.tBg, in: .rect(cornerRadius: 12, style: .continuous))
            case .failed(let message):
                ErrorBox(message: message)
                Button("다시 살펴보기", action: onScan).buttonStyle(SecondaryButtonStyle())
            case .loaded:
                groupList
            }
        }
    }

    @ViewBuilder
    private var groupList: some View {
        let groups = scan.visible(media)
        if groups.isEmpty {
            Hint(text: media == .video ? "이 페이지에는 영상이 없습니다." : "이 페이지에는 이미지가 없습니다.")
        } else {
            let shown = showAll ? groups : Array(groups.prefix(collapsedCount))
            VStack(spacing: 8) {
                ForEach(shown) { group in
                    GroupRow(group: group, referer: scan.pageURL, selected: scan.selected.contains(group.id)) {
                        withAnimation(.snappy(duration: 0.15)) { scan.toggle(group) }
                    }
                }
            }
            if groups.count > collapsedCount {
                Button(showAll ? "접기" : "묶음 \(groups.count - collapsedCount)개 더 보기") {
                    withAnimation(.snappy(duration: 0.2)) { showAll.toggle() }
                }
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.tInk)
                .buttonStyle(.plain)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 4)
            }
            Hint(text: "여러 개를 고를 수 있습니다. 같은 파일은 한 번만 받습니다.")
        }
    }
}

/// 묶음 한 줄: 고름 표시 · 이름 · 미리보기 몇 장
private struct GroupRow: View {
    let group: ElementGroup
    let referer: URL?
    let selected: Bool
    let onTap: () -> Void

    private var title: String {
        let kind = group.isVideo ? "영상" : "이미지"
        return group.isEverything ? "페이지의 모든 \(kind)" : "\(kind) 묶음"
    }

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    Circle().fill(selected ? Color.tAccent : Color.clear)
                    Circle().strokeBorder(selected ? Color.tInk.opacity(0.15) : Color.tLineStrong, lineWidth: 1.5)
                    if selected {
                        Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Color.tOnAccent)
                    }
                }
                .frame(width: 22, height: 22)
                .padding(.top, 1)

                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Color.tInk)
                        Text("\(group.count)개").font(.system(size: 14).monospacedDigit()).foregroundStyle(Color.tMuted)
                    }
                    HStack(spacing: 6) {
                        if group.previews.isEmpty {
                            PreviewTile(url: nil, referer: referer, isVideo: group.isVideo)
                        }
                        ForEach(group.previews, id: \.self) { url in
                            PreviewTile(url: url, referer: referer, isVideo: group.isVideo)
                        }
                    }
                    if !group.isEverything {
                        Text(group.selector)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(Color.tMuted)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.tBg, in: .rect(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(selected ? Color.tInk.opacity(0.7) : Color.tLine, lineWidth: selected ? 1.5 : 1)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title) \(group.count)개")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// 미리보기 한 장. 사이트가 다른 곳에서 보는 걸 막는 경우가 있어 페이지 주소를 Referer 로 붙여 받는다.
private struct PreviewTile: View {
    let url: URL?
    let referer: URL?
    let isVideo: Bool
    @State private var image: ImageFrames?
    @State private var failed = false

    var body: some View {
        ZStack {
            if isVideo && image == nil {
                Color.black
            } else {
                Checkerboard(cell: 6)
            }
            if let image {
                FramesView(frames: image, scale: 1).padding(3)
            } else if isVideo {
                EmptyView()
            } else if url != nil && !failed {
                ProgressView().controlSize(.mini)
            } else {
                Image(systemName: "photo").font(.system(size: 14)).foregroundStyle(Color.tMuted)
            }
            if isVideo {
                Image(systemName: "play.circle.fill")
                    .font(.system(size: 18))
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.black, .white.opacity(0.9))
            }
        }
        .frame(width: 52, height: 52)
        .clipShape(.rect(cornerRadius: 8, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Color.tLine) }
        .task(id: url) {
            guard let url, let referer else { return }
            image = await Collector.thumbnail(url, referer: referer)
            failed = image == nil
        }
    }
}
