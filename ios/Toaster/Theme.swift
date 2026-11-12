import SwiftUI

// 애플 기본 색(시스템 색)을 쓰고, 포인트 색은 카카오톡 노란색(#FEE500) 하나만 쓴다.
// 노란 바탕 위 글자는 #191919. 웹(web/src/app/globals.css)도 같은 값을 쓴다.
extension Color {
    #if os(iOS)
    static let tBg = Color(uiColor: .systemGroupedBackground)
    static let tSurface = Color(uiColor: .secondarySystemGroupedBackground)
    static let tLine = Color(uiColor: .separator)
    #else
    static let tBg = Color(nsColor: .windowBackgroundColor)
    static let tSurface = Color(nsColor: .controlBackgroundColor)
    static let tLine = Color(nsColor: .separatorColor)
    #endif
    static let tInk = Color.primary
    static let tMuted = Color.secondary
    /// 카카오 노란색. 위에 올리는 글자는 tOnAccent
    static let tAccent = Color(light: 0xFEE500, dark: 0xFEE500)
    static let tOnAccent = Color(light: 0x191919, dark: 0x191919)
    static let tDanger = Color.red
    static let tOk = Color.green
    static let tChecker = Color(light: 0xEDEDED, dark: 0x2A2A2C)
    static let tCheckerBase = Color(light: 0xFFFFFF, dark: 0x1C1C1E)
}

extension CollectedFile {
    var ext: String { (filename as NSString).pathExtension.uppercased() }
    var sizeText: String { formatBytes(size) }
}

/// 웹(result-panel.tsx)과 같은 표기: 512 B, 19.2 KB, 2.2 MB
func formatBytes(_ n: Int) -> String {
    if n < 1024 { return "\(n) B" }
    if n < 1024 * 1024 { return String(format: "%.1f KB", Double(n) / 1024) }
    return String(format: "%.1f MB", Double(n) / 1024 / 1024)
}

// MARK: - 버튼

extension View {
    /// 노란 리퀴드 글래스 큰 버튼 (화면의 주 동작 하나에만)
    func primaryGlassButton() -> some View {
        self.buttonStyle(.glassProminent)
            .tint(.tAccent)
            .foregroundStyle(Color.tOnAccent)
            .controlSize(.large)
            .buttonBorderShape(.capsule)
    }

    /// 투명 리퀴드 글래스 큰 버튼 (보조 동작)
    func secondaryGlassButton() -> some View {
        self.buttonStyle(.glass)
            .controlSize(.large)
            .buttonBorderShape(.capsule)
    }

    /// 목록(Form) 안에 버튼만 덩그러니 놓을 때: 줄 배경과 여백을 없앤다
    func bareRow() -> some View {
        self.listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
    }
}

/// 버튼 안 글자를 가로로 꽉 채운다
struct WideLabel: View {
    let title: String
    var systemImage: String?

    var body: some View {
        Group {
            if let systemImage { Label(title, systemImage: systemImage) } else { Text(title) }
        }
        .font(.headline)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 2)
    }
}

/// 입력칸 오른쪽 버튼. 비어 있으면 클립보드의 링크를 붙여 넣고, 뭔가 들어 있으면 전부 지운다.
/// 붙여넣기는 시스템 붙여넣기 버튼이라 "붙여넣기 허용" 알림이 뜨지 않는다.
struct PasteLinkButton: View {
    let text: String
    let onPaste: (String) -> Void
    let onClear: () -> Void

    var body: some View {
        Group {
            if text.isEmpty {
                PasteButton(payloadType: String.self) { strings in
                    if let text = strings.first?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
                        Task { @MainActor in onPaste(text) }
                    }
                }
                .labelStyle(.iconOnly)
            } else {
                Button("모두 지우기", systemImage: "xmark", action: onClear)
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderedProminent)
                    .fontWeight(.semibold)
            }
        }
        .buttonBorderShape(.capsule)
        .tint(.tInk)
        .fixedSize()
        .transition(.opacity)
        .animation(.snappy, value: text.isEmpty)
    }
}

/// 빨간 경고 줄 (목록 안 한 줄로 쓴다)
struct ErrorRow: View {
    let message: String

    var body: some View {
        Label {
            Text(message).fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "exclamationmark.triangle.fill")
        }
        .font(.subheadline)
        .foregroundStyle(Color.tDanger)
    }
}

/// 투명 이미지가 잘 보이게 깔아 두는 체크무늬
struct Checkerboard: View {
    var cell: CGFloat = 8

    var body: some View {
        Canvas { context, size in
            context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(.tCheckerBase))
            let cols = Int(ceil(size.width / cell)), rows = Int(ceil(size.height / cell))
            var path = Path()
            for row in 0..<rows {
                for col in 0..<cols where (row + col).isMultiple(of: 2) {
                    path.addRect(CGRect(x: CGFloat(col) * cell, y: CGFloat(row) * cell, width: cell, height: cell))
                }
            }
            context.fill(path, with: .color(.tChecker))
        }
    }
}
