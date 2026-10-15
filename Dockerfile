# Advance AI API + SPA fallback for Cloudflare Containers (linux/amd64).
# On Apple Silicon, build with: docker build --platform linux/amd64 ...
#
# Base image pinned by digest (multi-arch index digest, from RepoDigests)
# rather than the `node:22-slim` tag, so a tag move upstream can't silently
# change what's running. To refresh: `docker pull node:22-slim`, then
# `docker image inspect node:22-slim --format '{{.RepoDigests}}'` and copy
# the sha256 digest below for both stages. Verify the new image boots in
# Docker before rolling it out (see docs/operations/cloudflare-containers.md
# "Pre-cutover hardening").
FROM node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
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
ARG VITE_ADPACK_STUDIO=
RUN npm run build && npm run build:api

FROM node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 NODE_OPTIONS=--enable-source-maps ADVANCE_RUNTIME=cloudflare-container
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force \
 && node -e "const s=require('sharp');console.log('sharp ok',s.versions.vips)" \
 && node -e "require('pdf-parse');console.log('pdf-parse ok')" \
 && node -e "const {Resvg}=require('@resvg/resvg-js');new Resvg('<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1\" height=\"1\"/>').render();console.log('resvg ok')"
COPY --from=build /app/dist ./dist
# dist-api includes lib/adpack/render/fonts/** (TTFs + OFL licenses), copied
# by scripts/build-api.mjs next to the compiled render module so its
# `new URL('./fonts/x.ttf', import.meta.url)` lookups resolve without
# ADPACK_FONTS_DIR.
COPY --from=build /app/dist-api ./dist-api
COPY server.mjs ./
COPY cf/http-rules.mjs ./cf/http-rules.mjs
# Build-time smoke: renders one real 1:1 ad through the COMPILED renderer
# (satori -> @resvg/resvg-js linux-x64-gnu -> sharp, bundled fonts). Any
# missing native binding or font fails the image build. Script removed after.
COPY scripts/adpack-render-smoke.mjs ./scripts/adpack-render-smoke.mjs
RUN node scripts/adpack-render-smoke.mjs dist-api && rm -rf scripts
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
