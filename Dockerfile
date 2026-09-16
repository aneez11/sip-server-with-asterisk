# Multi-stage: build shared + api + web, then run the API (which serves web/dist).
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY shared/package.json shared/
COPY api/package.json api/
COPY web/package.json web/

RUN npm install --workspaces --include-workspace-root

COPY shared shared
COPY api api
COPY web web

RUN npm run build -w @infinity/shared \
    && npm run build -w @infinity/api \
    && npm run build -w @infinity/web

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/shared/dist /app/shared/dist
COPY --from=build /app/shared/package.json /app/shared/package.json
COPY --from=build /app/api/dist /app/api/dist
COPY --from=build /app/api/package.json /app/api/package.json
COPY --from=build /app/api/prisma /app/api/prisma
COPY --from=build /app/web/dist /app/web/dist
COPY --from=build /app/node_modules /app/node_modules

WORKDIR /app/api
EXPOSE 3001
CMD ["node", "dist/index.js"]
