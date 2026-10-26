FROM node:24-trixie-slim AS build-deps
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

FROM build-deps AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM build-deps AS media-verification
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg libheif-examples libheif-plugin-libde265 libheif-plugin-x265 \
  && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm run test -w @aether/server -- test/presentation-media.test.ts test/presentation-bounce.test.ts test/heif-decoder.test.ts

FROM node:24-trixie-slim AS production-deps
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --workspace=@aether/server --include-workspace-root=false \
  && npm cache clean --force

FROM node:24-trixie-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV AETHER_HOST=0.0.0.0
ENV AETHER_PORT=3030
ENV AETHER_DATA_DIR=/data
ENV AETHER_WEB_DIST=/app/apps/web/dist

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg libheif-examples libheif-plugin-libde265 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY apps/server/package.json apps/server/package.json
COPY --from=production-deps /app/node_modules node_modules
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist

RUN install -d -o node -g node /data \
  && install -d /media

USER node
EXPOSE 3030
CMD ["node", "apps/server/dist/index.js"]
