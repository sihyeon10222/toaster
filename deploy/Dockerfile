# toaster-client 웹(Next.js) 이미지. 빌드 컨텍스트는 toaster-client/web (deploy/compose.yaml 참고)
#
#   docker build -f deploy/Dockerfile \
#     --build-arg NEXT_PUBLIC_TOASTER_API_URL=https://api.example.com -t toaster-web web
#
# NEXT_PUBLIC_* 값은 빌드할 때 JS 번들에 박히므로, 서버 주소가 바뀌면 다시 빌드해야 한다.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_TOASTER_API_URL=http://127.0.0.1:8000
ENV NEXT_PUBLIC_TOASTER_API_URL=${NEXT_PUBLIC_TOASTER_API_URL} \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
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
