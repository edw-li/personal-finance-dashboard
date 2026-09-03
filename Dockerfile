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
RUN npm run build

FROM nginx:1.25-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
