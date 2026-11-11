import SwiftUI
import UniformTypeIdentifiers

/// 설정: 저장 폴더, 텔레그램 스티커 변환 서버 주소
struct SettingsView: View {
    @Environment(SaveFolder.self) private var folder
    @Environment(\.dismiss) private var dismiss
    @AppStorage(Sticker.serverKey) private var server = ""
    @State private var picking = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
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
                        Hint(text: "zip 으로 묶지 않고 이 폴더 안에 작업마다 폴더를 만들어 파일을 그대로 넣습니다. 예: 폴더/끝주소/001.png, 폴더/끝주소_telegram/1.webm")
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        FieldLabel(text: "텔레그램 변환 서버")
                        TextField(Sticker.defaultServer, text: $server)
                            .font(.system(size: 15))
                            .urlInput()
                            .focused($focused)
                            .fieldChrome(focused: focused)
                        Hint(text: "비워 두면 Vercel 에 올린 \(Sticker.defaultServer) 를 씁니다. 움직이는 스티커(VP9 WEBM)는 애플 기기에서 만들 수 없어 이 서버가 변환합니다. 맥북이 꺼져 있어도 됩니다.")
                    }

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
        }
        .tint(.tInk)
        #if os(macOS)
        .frame(minWidth: 460, minHeight: 360)
        #endif
    }
}
