# toaster-client

카카오 이모티콘 링크나 아무 페이지 주소를 넣으면 이미지·영상을 모두 받아 저장하는 웹과 아이폰·맥 앱.
텔레그램 스티커 규격으로 바꿔 저장하는 기능도 있다.
**따로 띄울 서버가 없다.** (예전 파이썬 toaster-server 는 더 이상 쓰지 않는다.)

- `web/`: Next.js 웹. Vercel 에 올리면 맥북을 꺼도 동작한다.
- `ios/`: SwiftUI 앱 (iOS 17+, macOS 14+ 한 타깃). 페이지 읽기·파일 받기는 기기 안에서 한다.
- `deploy/`: Vercel 대신 Docker 로 웹을 직접 띄울 때 (Dockerfile, compose)

## 기능

- **카카오 이모티콘 탭** (`#kakao`, 기본): 이모티콘샵에서 공유한 링크를 "붙여넣기"로 넣고 받기를 누르면
  이모티콘을 모두 받아 `<끝주소>.zip` 으로 저장한다. 이모티콘 목록은 페이지 HTML 에 그대로 들어 있어
  브라우저 렌더링이 필요 없다. 선택자는 `web/src/lib/kakao.ts`, `ios/Toaster/Kakao.swift` 에 있다.
- **일반 페이지 탭** (`#general`): 아무 페이지 주소를 넣으면 먼저 페이지를 훑어 이미지·영상을 `태그.클래스` 모양이
  같은 것끼리 묶어 미리보기(SVG 포함)와 개수로 보여 준다. 받을 묶음을 고르면 되고(여러 개 가능), CSS 선택자를 아는 사람은
  "직접 입력"도 된다. 받을 종류(이미지 / 영상 / 둘 다)를 고르면 맞는 묶음만 보인다.
  묶음은 웹은 `/api/elements`, 앱은 기기 안에서 같은 규칙(`web/src/lib/server/extract.ts`, `ios/Toaster/Collector.swift`)으로 만든다. 직접 링크된 영상 파일(mp4, webm, mov 등)만 받으며
  스트리밍(m3u8)이나 DRM 영상은 지원하지 않는다.
  - **자바스크립트로 그리는 페이지**는 iOS 앱에서만 된다 (아이폰 안의 보이지 않는 WKWebView 로 열어 끝까지 스크롤).
- **텔레그램 스티커로 저장** (웹): 받기가 끝난 결과에서 버튼을 누르면 파일마다
  [텔레그램 스티커 규격](https://core.telegram.org/import-stickers)에 맞게 바꿔 `<이름>.zip`(파일이 하나면 그 파일)으로 저장한다.
  - 파일 이름은 형식과 상관없이 성공한 것만 순서대로 `1.webm`, `2.png`, `3.png` …
  - 팩 썸네일도 같이 넣는다: 첫 번째 이미지(GIF 포함, 이미지가 없으면 첫 영상)로 만든다.
    정지 그림은 `thumbnail.png`(정확히 100x100, 128KB 이하), 움직이는 GIF·영상은 `thumbnail.webm`(100x100, VP9, 32KB 이하).
    비율이 다르면 투명 여백을 붙여 정사각형으로 만든다. ([Bot API setStickerSetThumbnail](https://core.telegram.org/bots/api#setstickersetthumbnail) 규격, `/api/telegram?thumb=1`)
  - 정지 이미지 → 긴 변 512px, 투명 배경 PNG (512KB 를 넘으면 WEBP 로 줄임)
  - 움직이는 GIF·WEBP, 영상 → 긴 변 512px, 30fps, VP9 WEBM(투명 채널 포함), 소리 없음, 256KB 이하
  - 3초보다 길면 최대 2배까지 빠르게 돌려 맞추고, 그래도 길면 앞 3초만 남긴다.
  - 변환은 Next.js 함수 `/api/telegram` 이 sharp 와 ffmpeg(`ffmpeg-static`, 또는 `FFMPEG_PATH`)로 한다.
    원본은 브라우저가 올리지 않고 함수가 주소로 다시 받는다 (Vercel 요청 크기 4.5MB 제한 때문).
- 파일 형식은 서버가 준 헤더가 아니라 실제 바이트로 판별하고, 같은 파일이 여러 주소로 나오면 한 번만 받는다.
- **같은 그림은 가장 큰 것만**: 한 요소의 srcset·src·data-src 처럼 크기만 다른 주소 중에서는 가장 큰 것 하나만 받고,
  `<picture>` 안의 다른 형식(`<source>`)은 `<img>` 가 있으면 건너뛴다. 받은 뒤에도 생김새 해시(dHash)가 같고 비율이 같은데
  크기만 다른 그림은 큰 것만 남긴다(`web/src/lib/image-look.ts`, `ios/Toaster/ImageLook.swift`). 크기가 같은 그림끼리는 합치지 않는다.
- **최근 작업 삭제**: 왼쪽으로 밀면 삭제 버튼이 나오고 끝까지 밀면 바로 지운다. 웹은 마우스를 올리면 ✕, 맥은 우클릭.
- **설정 > 저장 공간**: 캐시 삭제(미리보기·임시 파일), 데이터 삭제(최근 작업과 받아 둔 파일), 앱 초기화(전부 + 입력·저장 폴더 설정).
  내려받은 zip, 저장 폴더에 넣은 파일, 사진 앱의 사진은 지우지 않는다.

## 어떻게 서버 없이 도는가

| | 페이지 읽기 | 파일 받기 | zip |
|---|---|---|---|
| 웹 | Next.js 함수 `/api/scan`, `/api/elements` (cheerio) | Next.js 함수 `/api/file` 이 대신 받아 흘려보냄 | 브라우저에서 fflate |
| 웹 (텔레그램 스티커) | | Next.js 함수 `/api/telegram` 이 받아 sharp·ffmpeg 로 변환 | 브라우저에서 fflate |
| iOS | URLSession + SwiftSoup (렌더링은 WKWebView) | URLSession | 시스템 폴더 압축(NSFileCoordinator) |

웹 브라우저는 카카오 같은 다른 사이트의 HTML·이미지 내용을 직접 읽을 수 없어서(CORS), 웹만 같은
Next.js 프로젝트 안의 작은 함수 두 개가 대신 읽는다. 이 함수들은 사설망·루프백 주소로 가는 요청을 막는다
(`web/src/lib/server/safe-fetch.ts`).

## 웹 개발

```bash
cd web
npm install
npm run dev                   # http://localhost:3000
```

## 웹 배포 (Vercel)

1. 이 저장소를 Vercel 에 연결하고 Root Directory 를 `web` 으로 지정한다.
2. 환경 변수는 필요 없다. 그대로 배포하면 끝.

Docker 로 직접 띄우려면:

```bash
cd deploy
cp .env.example .env          # 필요하면 WEB_PORT 변경
docker compose up -d --build
```

## iOS 앱 개발

```bash
cd ios
xcodegen                      # project.yml → Toaster.xcodeproj (SwiftSoup 패키지 포함)
open Toaster.xcodeproj
```

Xcode 에서 실행 대상을 아이폰(시뮬레이터) 또는 "My Mac" 으로 고르면 된다. 맥은 팀 없이 이 맥에서 바로 실행되게 로컬 서명한다.

- **저장**: zip 으로 묶지 않는다. 설정(톱니바퀴)에서 고른 폴더 안에 작업마다 폴더를 만들어 파일을 그대로 넣는다.
  `<폴더>/<끝주소>/001.png …`, 텔레그램은 `<폴더>/<끝주소>/1.webm … thumbnail.png`. 같은 이름의 폴더가 있으면 `<끝주소>_2`, `<끝주소>_3` … 으로 만든다. 맥은 처음엔 다운로드 폴더, 아이폰은 처음 저장할 때 고른다.
- **텔레그램 스티커**: VP9 WEBM 은 애플 기기에서 만들 수 없어 Vercel 에 올린 웹의 `/api/telegram` 이 변환한다.
  변환 서버는 `https://toaster-six.vercel.app`(이 저장소의 Vercel 배포)로 고정이다. 맥북이 꺼져 있어도 된다.
- **SVG 미리보기**: 애플 기기의 ImageIO 는 SVG 를 못 읽어서 보이지 않는 WKWebView 의 캔버스에 그려 PNG 로 받아 보여 준다(`SVGRenderer.swift`).
- 아이폰은 사진 앱에 모두 저장하기도 된다.
