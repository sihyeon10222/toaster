import SwiftUI

// 웹(web/src/app/globals.css)과 같은 색: 카카오톡 노란색(#FEE500) 포인트 하나. 노란 바탕 위 글자는 #191919.
extension Color {
    static let tBg = Color(light: 0xF6F6F4, dark: 0x121212)
    static let tSurface = Color(light: 0xFFFFFF, dark: 0x1C1C1C)
    static let tSurface2 = Color(light: 0xEFEFEC, dark: 0x272727)
    static let tInk = Color(light: 0x191919, dark: 0xF2F2F2)
    static let tMuted = Color(light: 0x767676, dark: 0x9A9A9A)
    static let tLine = Color(light: 0x191919, dark: 0xFFFFFF, alpha: 0.09)
    static let tLineStrong = Color(light: 0x191919, dark: 0xFFFFFF, alpha: 0.16)
    /// 카카오 노란색. 위에 올리는 글자는 tOnAccent
    static let tAccent = Color(light: 0xFEE500, dark: 0xFEE500)
    static let tOnAccent = Color(light: 0x191919, dark: 0x191919)
    static let tDanger = Color(light: 0xD92D20, dark: 0xF97066)
    static let tOk = Color(light: 0x12A150, dark: 0x4ADE80)
    static let tChecker = Color(light: 0xF0F0EE, dark: 0x242424)
}

extension JobStatus {
    /// 상태 꼬리표 (글자색, 바탕색)
    var colors: (fg: Color, bg: Color) {
        switch self {
        case .fetching, .downloading: (.tOnAccent, .tAccent)
        case .done: (.tOk, Color.tOk.opacity(0.12))
        case .failed: (.tDanger, Color.tDanger.opacity(0.12))
        }
    }
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

// MARK: - 카드·버튼·입력칸

extension View {
    /// 흰 카드
    func card(padding: CGFloat = 20) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.tSurface, in: .rect(cornerRadius: 20, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.tLine) }
    }
}

/// 노란 큰 버튼
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(Color.tOnAccent)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(Color.tAccent, in: .rect(cornerRadius: 14, style: .continuous))
            .opacity(isEnabled ? (configuration.isPressed ? 0.85 : 1) : 0.5)
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// 테두리 버튼
struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(Color.tInk)
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(configuration.isPressed ? Color.tSurface2 : Color.tSurface, in: .rect(cornerRadius: 14, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.tLineStrong) }
    }
}

/// 입력칸 테두리. 포커스를 받으면 진한 테두리에 노란 번짐.
struct FieldChrome: ViewModifier {
    var focused: Bool

    func body(content: Content) -> some View {
        content
            .textFieldStyle(.plain)
            .padding(.horizontal, 14)
            .frame(height: 50)
            .background(Color.tBg, in: .rect(cornerRadius: 12, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(focused ? Color.tInk.opacity(0.6) : Color.tLineStrong, lineWidth: focused ? 1.5 : 1)
            }
            .shadow(color: Color.tAccent.opacity(focused ? 0.7 : 0), radius: 5)
            .animation(.easeOut(duration: 0.15), value: focused)
    }
}

extension View {
    func fieldChrome(focused: Bool) -> some View { modifier(FieldChrome(focused: focused)) }
}

struct FieldLabel: View {
    let text: String
    var body: some View {
        Text(text).font(.system(size: 14, weight: .semibold)).foregroundStyle(Color.tInk)
    }
}

struct Hint: View {
    let text: String
    var body: some View {
        Text(text).font(.system(size: 13)).foregroundStyle(Color.tMuted).fixedSize(horizontal: false, vertical: true)
    }
}

/// 둥근 세그먼트 버튼 (웹의 Segmented 와 같은 모양)
struct PillSegmented<T: Hashable>: View {
    @Binding var selection: T
    let options: [(value: T, label: String)]
    var compact = false

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.value) { option in
                let selected = option.value == selection
                Button {
                    withAnimation(.snappy(duration: 0.2)) { selection = option.value }
                } label: {
                    Text(option.label)
                        .font(.system(size: compact ? 13 : 14, weight: selected ? .semibold : .regular))
                        .foregroundStyle(selected ? Color.tInk : Color.tMuted)
                        .frame(maxWidth: .infinity)
                        .frame(height: compact ? 30 : 38)
                        .background {
                            if selected {
                                RoundedRectangle(cornerRadius: compact ? 8 : 10, style: .continuous)
                                    .fill(Color.tSurface)
                                    .shadow(color: .black.opacity(0.07), radius: 3, y: 1)
                            }
                        }
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(3)
        .background(Color.tSurface2, in: .rect(cornerRadius: compact ? 10 : 13, style: .continuous))
    }
}

/// 상태 꼬리표 (완료 · 받는 중 …)
struct StatusPill: View {
    let label: String
    let colors: (fg: Color, bg: Color)
    var spinning = false

    var body: some View {
        HStack(spacing: 6) {
            if spinning { ProgressView().controlSize(.mini).tint(colors.fg) }
            Text(label).font(.system(size: 12, weight: .semibold))
        }
        .foregroundStyle(colors.fg)
        .padding(.horizontal, 10)
        .frame(height: 26)
        .background(colors.bg, in: .capsule)
    }
}

/// 클립보드의 링크를 붙여 넣는 버튼. 시스템 붙여넣기 버튼이라 "붙여넣기 허용" 알림이 뜨지 않는다.
struct PasteLinkButton: View {
    let onPaste: (String) -> Void

    var body: some View {
        PasteButton(payloadType: String.self) { strings in
            if let text = strings.first?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
                Task { @MainActor in onPaste(text) }
            }
        }
        .labelStyle(.titleAndIcon)
        .buttonBorderShape(.roundedRectangle(radius: 12))
        .tint(.tInk)
        .frame(height: 50)
    }
}

/// 빨간 알림 상자
struct ErrorBox: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.circle")
            .font(.system(size: 14))
            .foregroundStyle(Color.tDanger)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Color.tDanger.opacity(0.06), in: .rect(cornerRadius: 12, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.tDanger.opacity(0.25)) }
    }
}

/// 투명 이미지가 잘 보이게 깔아 두는 체크무늬
struct Checkerboard: View {
    var cell: CGFloat = 8

    var body: some View {
        Canvas { context, size in
            context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(.tSurface))
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
