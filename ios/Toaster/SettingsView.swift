import SwiftUI
import UniformTypeIdentifiers

/// 설정: 저장 폴더, 캐시·데이터 삭제, 앱 초기화
struct SettingsView: View {
    let store: JobStore
    /// 앱 초기화: 기록·캐시·설정을 모두 지우고 첫 화면으로 돌아간다
    let onReset: () -> Void

    @Environment(SaveFolder.self) private var folder
    @Environment(\.dismiss) private var dismiss
    @State private var picking = false
    @State private var error: String?
    @State private var notice: String?
    @State private var cacheBytes: Int?
    @State private var asking: Action?

    private enum Action: Identifiable {
        case cache, data, reset
        var id: Self { self }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    folderSection
                    storageSection
                    if let error { ErrorBox(message: error) }
                }
                .padding(20)
            }
            .background(Color.tBg)
            .navigationTitle("설정")
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("완료") { dismiss() } }
            }
            .fileImporter(isPresented: $picking, allowedContentTypes: [.folder]) { result in
                do {
                    try folder.choose(result.get())
                    error = nil
                } catch {
                    self.error = "폴더를 기억하지 못했습니다: \(error.localizedDescription)"
                }
            }
            .task { await measureCache() }
            .confirmationDialog(
                asking.map(title) ?? "", isPresented: Binding(get: { asking != nil }, set: { if !$0 { asking = nil } }),
                titleVisibility: .visible, presenting: asking
            ) { action in
                Button(buttonTitle(action), role: .destructive) { perform(action) }
                Button("취소", role: .cancel) {}
            } message: { action in
                Text(message(action))
            }
        }
        .tint(.tInk)
        #if os(macOS)
        .frame(minWidth: 460, minHeight: 420)
        #endif
    }

    // MARK: 저장 폴더

    private var folderSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            FieldLabel(text: "저장 폴더")
            HStack(spacing: 10) {
                Image(systemName: "folder.fill").foregroundStyle(Color.tMuted)
                Text(folder.displayName)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(folder.url == nil ? Color.tMuted : Color.tInk)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Button(folder.url == nil ? "고르기" : "바꾸기") { picking = true }
                    .font(.system(size: 14, weight: .semibold))
                    .buttonStyle(.plain)
                    .foregroundStyle(Color.tInk)
            }
            .fieldChrome(focused: false)
            Hint(text: "zip 으로 묶지 않고 이 폴더 안에 작업마다 폴더를 만들어 파일을 그대로 넣습니다. 예: 폴더/끝주소/001.png. 같은 이름이 있으면 끝주소_2, 끝주소_3 … 으로 만듭니다.")
        }
    }

    // MARK: 저장 공간

    private var storageSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            FieldLabel(text: "저장 공간")
            VStack(spacing: 0) {
                ManageRow(
                    icon: "sparkles", title: "캐시 삭제",
                    detail: "미리보기·임시 파일", value: cacheBytes.map(formatBytes)
                ) { asking = .cache }
                Divider().overlay(Color.tLine).padding(.leading, 52)
                ManageRow(
                    icon: "tray.full", title: "데이터 삭제",
                    detail: "최근 작업 \(store.entries.count)개와 받아 둔 파일",
                    value: store.entries.isEmpty ? nil : formatBytes(store.downloadedBytes)
                ) { asking = .data }
                .disabled(store.entries.isEmpty)
                Divider().overlay(Color.tLine).padding(.leading, 52)
                ManageRow(
                    icon: "arrow.counterclockwise", title: "앱 초기화",
                    detail: "모든 기록·캐시·설정을 지우고 처음 상태로", destructive: true
                ) { asking = .reset }
            }
            .card(padding: 4)
            if let notice {
                Label(notice, systemImage: "checkmark.circle.fill")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Color.tOk)
                    .transition(.opacity)
            }
            Hint(text: "저장 폴더에 넣은 파일과 사진 앱에 저장한 사진은 지우지 않습니다.")
        }
    }

    // MARK: 확인 창

    private func title(_ action: Action) -> String {
        switch action {
        case .cache: "캐시를 지울까요?"
        case .data: "데이터를 지울까요?"
        case .reset: "앱을 초기화할까요?"
        }
    }

    private func message(_ action: Action) -> String {
        switch action {
        case .cache: "페이지 미리보기와 지난 작업의 임시 파일을 지웁니다. 최근 작업은 그대로 남습니다."
        case .data: "최근 작업 기록과 기기에 받아 둔 파일을 모두 지웁니다. 받는 중인 작업은 멈춥니다. 되돌릴 수 없습니다."
        case .reset: "최근 작업, 받아 둔 파일, 캐시, 저장 폴더 설정을 모두 지웁니다. 되돌릴 수 없습니다."
        }
    }

    private func buttonTitle(_ action: Action) -> String {
        switch action {
        case .cache: "캐시 삭제"
        case .data: "데이터 삭제"
        case .reset: "초기화"
        }
    }

    private func perform(_ action: Action) {
        switch action {
        case .cache:
            Housekeeping.clearCache(keeping: store.liveFolders)
            show("캐시를 지웠습니다.")
        case .data:
            store.removeAll()
            show("최근 작업과 받아 둔 파일을 지웠습니다.")
        case .reset:
            onReset()
            return
        }
        Task { await measureCache() }
    }

    private func show(_ text: String) {
        withAnimation { notice = text }
    }

    private func measureCache() async {
        let live = store.liveFolders
        cacheBytes = await Task.detached { Housekeeping.cacheBytes(keeping: live) }.value
    }
}

/// 저장 공간 한 줄: 아이콘 · 제목/설명 · 크기
private struct ManageRow: View {
    let icon: String
    let title: String
    let detail: String
    var value: String?
    var destructive = false
    let action: () -> Void

    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(destructive ? Color.tDanger : Color.tInk)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(destructive ? Color.tDanger : Color.tInk)
                    Text(detail).font(.system(size: 13)).foregroundStyle(Color.tMuted).lineLimit(1)
                }
                Spacer(minLength: 8)
                if let value {
                    Text(value).font(.system(size: 13).monospacedDigit()).foregroundStyle(Color.tMuted)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
            .contentShape(.rect)
            .opacity(isEnabled ? 1 : 0.45)
        }
        .buttonStyle(.plain)
    }
}
