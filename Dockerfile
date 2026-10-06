# Advance AI API + SPA fallback for Cloudflare Containers (linux/amd64).
# On Apple Silicon, build with: docker build --platform linux/amd64 ...
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Public, build-time only (never secrets). ARGs are visible to RUN as env vars; Vite reads VITE_*.
ARG VITE_APP_ENV=
ARG VITE_SUPABASE_URL=
ARG VITE_SUPABASE_ANON_KEY=
ARG VITE_CREDITS_V1=
ARG VITE_PREVIEW_HOSTS=
RUN npm run build && npm run build:api

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 NODE_OPTIONS=--enable-source-maps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force \
 && node -e "const s=require('sharp');console.log('sharp ok',s.versions.vips)" \
 && node -e "require('pdf-parse');console.log('pdf-parse ok')"
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-api ./dist-api
COPY server.mjs ./
COPY cf/http-rules.mjs ./cf/http-rules.mjs
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
