# toaster-client

[toaster-server](https://github.com/sihyeon10222/toaster-server) API를 호출하는 클라이언트.
크롤링·다운로드는 서버가 하고, 클라이언트는 입력과 결과 표시·저장만 한다.

- `web/`: Next.js 웹
- `deploy/`: 웹 Docker 배포 (Dockerfile, compose)

## 기능

- **카카오 이모티콘 탭** (`#kakao`, 기본): 이모티콘 링크 끝주소(`kakao-friends-classic`)나 공유 링크 전체를 넣으면
  이모티콘을 모두 받아 `<끝주소>.zip`으로 자동 저장한다. 이모티콘샵은 JS로 그려지므로
  **서버를 `WITH_BROWSER=true` 이미지로 띄워야 한다.** 선택자는 `web/src/lib/kakao.ts`에 있다.
- **일반 페이지 탭** (`#general`): 아무 페이지 주소와 CSS 선택자로 이미지를 모은다.

## 웹 개발

```bash
cd web
cp .env.example .env.local    # NEXT_PUBLIC_TOASTER_API_URL = 서버 주소
npm install
npm run dev                   # http://localhost:3000
```

서버의 `TOASTER_CORS_ORIGINS`에 웹 주소가 들어 있어야 브라우저에서 호출된다.

## Docker 배포

```bash
cd deploy
cp .env.example .env          # TOASTER_API_URL = 브라우저에서 접속할 서버 주소
docker compose up -d --build
```

`NEXT_PUBLIC_TOASTER_API_URL`은 빌드할 때 JS 번들에 들어간다. 서버 주소가 바뀌면 이미지를 다시 빌드해야 한다.
