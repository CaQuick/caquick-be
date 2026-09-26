# syntax=docker/dockerfile:1.7
# 앱 이미지 1개 — api·worker·migrate가 같은 이미지에 APP_ROLE·command만 다르다.
ARG NODE_IMAGE=node:24-bookworm-slim

# ---- deps: 잠금 파일 그대로 설치. postinstall(prisma generate)이 돌므로 스키마가 먼저 있어야 한다 ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# argon2는 linux-arm64·x64 prebuild가 있지만, prebuild가 안 맞는 플랫폼에서 node-gyp가 도는 경우를 위해 빌드 도구를 둔다(이 단계에만)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml prisma.config.ts ./
COPY .yarn/releases ./.yarn/releases
COPY prisma ./prisma
RUN yarn install --immutable

# ---- build: SDL 타입·문서·dist. CI(pr-check)와 같은 순서 ----
FROM deps AS build
COPY . .
RUN yarn graphql:codegen && yarn graphql:docs && yarn build && test -f dist/main.js

# ---- runtime ----
# dev 의존성까지 그대로 싣는다 — 같은 이미지로 `prisma migrate deploy`(prisma CLI)·`yarn outbox:requeue`(ts-node)를 돌리기
# 위해서다. 그래서 src·scripts·tsconfig도 함께 둔다. 슬림화(prod 의존성만)는 운영 실측 뒤 후속.
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/package.json /app/yarn.lock /app/.yarnrc.yml /app/prisma.config.ts /app/tsconfig.json ./
COPY --from=build --chown=node:node /app/.yarn/releases ./.yarn/releases
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/dist ./dist
# corepack은 첫 실행 때 패키지 매니저를 내려받으려 한다(런타임 네트워크 의존) — 릴리즈 파일을 바로 yarn으로 건다
# node 이미지에 든 yarn 1(classic) 심을 덮어쓴다
RUN ln -sf "$(ls /app/.yarn/releases/yarn-*.cjs | head -n 1)" /usr/local/bin/yarn
USER node
EXPOSE 4000
CMD ["node", "dist/main"]
