FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# The build's identity for the sidebar footer. This stage has neither git nor the repo
# (.dockerignore excludes .git), so vite.config.ts's git probe can only answer "dev" here —
# the caller passes the commit in instead. Unset is still a valid build, just an unlabeled one.
ARG BUILD_HASH=dev
ENV BUILD_HASH=$BUILD_HASH
# vite only — no `tsc -b` in the image. V8 sizes its heap from the machine's physical memory
# (about a quarter of it), so on a small VM the default cap lands near 480 MB; a full
# type-check of src/ (tests included) now needs more than that and dies after minutes of GC
# thrash (exit 134, 2026-09-04 deploy), while `vite build` fits in that heap with room to
# spare. Type-checking is the dev/CI gate (`npm run build`, tsc + vite) and does not change
# the emitted bundle: esbuild strips types without checking them. The explicit heap size
# stops the build depending on the host's RAM heuristic at all.
ENV NODE_OPTIONS=--max-old-space-size=1024
RUN npm run build:image

FROM nginx:1.25-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
