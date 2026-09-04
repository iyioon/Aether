FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV AETHER_HOST=0.0.0.0
ENV AETHER_PORT=3030
ENV AETHER_CONFIG_DIR=/config
ENV AETHER_CACHE_DIR=/cache
ENV AETHER_WEB_DIST=/app/apps/web/dist

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install --omit=dev

COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist

RUN mkdir -p /config /cache /media \
  && chown -R node:node /app /config /cache

USER node
EXPOSE 3030
CMD ["node", "apps/server/dist/index.js"]
