import SwiftUI

/// 왼쪽으로 밀면 뒤에서 빨간 삭제 버튼이 나오는 줄. 끝까지 밀면 바로 지운다.
/// 기록 목록이 List 가 아니라 카드 안 VStack 이라 시스템 swipeActions 를 못 써서 직접 만든다.
/// 한 번에 한 줄만 열리도록 열린 줄 id 를 바깥에서 들고 있는다.
struct SwipeToDelete<Content: View>: View {
    let id: String
    @Binding var openID: String?
    let onDelete: () -> Void
    @ViewBuilder let content: Content

    @State private var drag: CGFloat = 0
    @State private var horizontal: Bool?
    @State private var width: CGFloat = 0
    @State private var deleting = false

    private let reveal: CGFloat = 84
    private var isOpen: Bool { openID == id }
    private var offset: CGFloat {
        if deleting { return -width }
        let raw = (isOpen ? -reveal : 0) + drag
        return raw > 0 ? raw / 4 : raw  // 오른쪽으로는 살짝만 끌려 온다
    }
    /// 이만큼 넘게 밀었다가 놓으면 버튼을 누르지 않아도 지운다
    private var fullSwipe: CGFloat { max(reveal * 2, width * 0.55) }

    var body: some View {
        content
            .background(Color.tSurface)
            .overlay {
                // 열려 있을 때 줄을 누르면 화면을 넘기지 않고 닫기만 한다 (offset 앞에 둬야 삭제 버튼을 덮지 않는다)
                if isOpen {
                    Color.clear.contentShape(.rect).onTapGesture { close() }
                }
            }
            .offset(x: offset)
            .simultaneousGesture(swipe)
            // 삭제 버튼은 줄 위에, 밀려서 드러난 폭만큼만 그린다 (뒤에 두면 탭이 줄에 먼저 닿는다)
            .overlay(alignment: .trailing) {
                if offset < -1 {
                    Button(role: .destructive, action: delete) {
                        VStack(spacing: 3) {
                            Image(systemName: "trash").font(.system(size: 16, weight: .semibold))
                            Text("삭제").font(.system(size: 12, weight: .semibold))
                        }
                        .foregroundStyle(.white)
                        .frame(width: reveal)
                        .frame(width: -offset, alignment: -offset > fullSwipe ? .leading : .center)
                        .frame(maxHeight: .infinity)
                        .background(Color.tDanger)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHidden(true)
                }
            }
        .clipShape(.rect(cornerRadius: 16, style: .continuous))
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .animation(.snappy(duration: 0.25), value: openID)
        .accessibilityAction(named: "삭제", delete)
        .contextMenu {
            Button("삭제", systemImage: "trash", role: .destructive, action: delete)
        }
    }

    private var swipe: some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { value in
                if horizontal == nil {
                    horizontal = abs(value.translation.width) > abs(value.translation.height)
                    if horizontal == true, openID != id { withAnimation(.snappy(duration: 0.2)) { openID = nil } }
                }
                guard horizontal == true else { return }
                drag = value.translation.width
            }
            .onEnded { value in
                defer { horizontal = nil }
                guard horizontal == true else { return }
                let base: CGFloat = isOpen ? -reveal : 0
                let end = base + value.translation.width
                let predicted = base + value.predictedEndTranslation.width
                if end < -fullSwipe || (predicted < -width && end < -reveal) {
                    delete()
                    return
                }
                withAnimation(.snappy(duration: 0.25)) {
                    openID = min(end, predicted) < -reveal / 2 ? id : (openID == id ? nil : openID)
                    drag = 0
                }
            }
    }

    private func close() {
        withAnimation(.snappy(duration: 0.25)) { openID = nil }
    }

    private func delete() {
        #if os(iOS)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        #endif
        withAnimation(.easeOut(duration: 0.2)) { deleting = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            if openID == id { openID = nil }
            withAnimation(.snappy(duration: 0.25)) { onDelete() }
        }
    }
}
