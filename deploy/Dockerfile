# toaster 웹(Next.js) 이미지. Vercel 대신 직접 띄울 때 쓴다. 빌드 컨텍스트는 toaster/web
#
#   docker build -f deploy/Dockerfile -t toaster-web web
#
# 따로 띄울 서버는 없다. 페이지·파일 받기는 이 Next.js 안의 /api/scan, /api/file 이 한다.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
# 텔레그램 스티커 변환(/api/telegram)용. 알파인 패키지의 ffmpeg 를 쓴다 (VP9 포함)
RUN apk add --no-cache ffmpeg
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1

CMD ["node", "server.js"]
