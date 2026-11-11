# toaster-client

[toaster-server](https://github.com/sihyeon10222/toaster-server) API를 호출하는 클라이언트.
크롤링·다운로드는 서버가 하고, 클라이언트는 입력과 결과 표시·저장만 한다.

- `web/`: Next.js 웹
- `ios/`: SwiftUI 앱 (iOS 17+)
- `deploy/`: 웹 Docker 배포 (Dockerfile, compose)

## 기능

- **카카오 이모티콘 탭** (`#kakao`, 기본): 이모티콘 링크 끝주소(`kakao-friends-classic`)나 공유 링크 전체를 넣으면
  이모티콘을 모두 받아 `<끝주소>.zip`으로 자동 저장한다. 이모티콘샵은 JS로 그려지므로
  **서버를 `WITH_BROWSER=true` 이미지로 띄워야 한다.** 선택자는 `web/src/lib/kakao.ts`에 있다.
- **일반 페이지 탭** (`#general`): 아무 페이지 주소와 CSS 선택자로 이미지·영상을 모은다.
  받을 종류(이미지 / 영상 / 둘 다)를 고를 수 있고, 영상은 결과 화면에서 바로 재생된다.
  직접 링크된 영상 파일(mp4, webm, mov 등)만 받으며 스트리밍(m3u8)이나 DRM 영상은 지원하지 않는다.
- **영상 구간 자르기**: 영상 카드의 "✂️ 구간 자르기"로 시작·끝 시각을 골라 그 부분만 받는다.
  기본은 정확하게 잘라 mp4로 저장하고, "빠르게 자르기"는 원본 형식 그대로지만 시작이 앞쪽 키프레임으로 당겨진다.
  서버에 ffmpeg가 있어야 한다 (toaster-server Docker 이미지에는 들어 있다).

## 웹 개발

```bash
cd web
cp .env.example .env.local    # NEXT_PUBLIC_TOASTER_API_URL = 서버 주소
npm install
npm run dev                   # http://localhost:3000
```

서버의 `TOASTER_CORS_ORIGINS`에 웹 주소가 들어 있어야 브라우저에서 호출된다.

## iOS 앱 개발

```bash
cd ios
xcodegen                      # project.yml → Toaster.xcodeproj
open Toaster.xcodeproj
```

웹과 같은 두 탭(카카오 이모티콘 / 일반 페이지)이 있다. 결과는 사진 앱에 저장하거나 `<끝주소>.zip`을 공유 시트로 내보낸다.
서버 주소는 기본 `http://127.0.0.1:8000`(시뮬레이터용)이고, 실기기에서는 앱의 서버 설정에서 Mac IP나 배포 주소로 바꾼다.

## Docker 배포

```bash
cd deploy
cp .env.example .env          # TOASTER_API_URL = 브라우저에서 접속할 서버 주소
docker compose up -d --build
```

`NEXT_PUBLIC_TOASTER_API_URL`은 빌드할 때 JS 번들에 들어간다. 서버 주소가 바뀌면 이미지를 다시 빌드해야 한다.
