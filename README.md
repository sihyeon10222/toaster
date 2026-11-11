# toaster-client

[toaster-server](https://github.com/sihyeon10222/toaster-server) API를 호출하는 클라이언트.
크롤링·다운로드는 서버가 하고, 클라이언트는 입력과 결과 표시·저장만 한다.

- `web/`: Next.js 웹
- `deploy/`: 웹 Docker 배포 (Dockerfile, compose)

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
