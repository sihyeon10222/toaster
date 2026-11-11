import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

// 아이폰과 맥에서 다르게 동작하는 것들을 한곳에 모은다.

extension View {
    /// 주소 입력칸: 아이폰은 URL 키보드, 자동 대문자·자동 고침 끔
    func urlInput() -> some View {
        #if os(iOS)
        self.keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
        #else
        self.autocorrectionDisabled()
        #endif
    }

    /// 코드처럼 그대로 치는 입력칸 (CSS 선택자 등)
    func plainInput() -> some View {
        #if os(iOS)
        self.textInputAutocapitalization(.never).autocorrectionDisabled()
        #else
        self.autocorrectionDisabled()
        #endif
    }

    func inlineNavigationTitle() -> some View {
        #if os(iOS)
        self.navigationBarTitleDisplayMode(.inline)
        #else
        self
        #endif
    }

    func hiddenNavigationBar() -> some View {
        #if os(iOS)
        self.toolbar(.hidden, for: .navigationBar)
        #else
        self
        #endif
    }
}

func copyToPasteboard(_ text: String) {
    #if os(iOS)
    UIPasteboard.general.string = text
    #else
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
    #endif
}

extension Color {
    /// 밝은·어두운 화면에서 다른 색
    init(light: UInt32, dark: UInt32, alpha: CGFloat = 1) {
        func rgb(_ hex: UInt32) -> (CGFloat, CGFloat, CGFloat) {
            (CGFloat((hex >> 16) & 0xFF) / 255, CGFloat((hex >> 8) & 0xFF) / 255, CGFloat(hex & 0xFF) / 255)
        }
        #if os(iOS)
        self.init(uiColor: UIColor { traits in
            let (r, g, b) = rgb(traits.userInterfaceStyle == .dark ? dark : light)
            return UIColor(red: r, green: g, blue: b, alpha: alpha)
        })
        #else
        self.init(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            let (r, g, b) = rgb(isDark ? dark : light)
            return NSColor(srgbRed: r, green: g, blue: b, alpha: alpha)
        })
        #endif
    }
}
