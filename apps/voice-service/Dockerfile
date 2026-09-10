# Built from the repository root, because the service is a pnpm workspace
# member and resolves @sidecar packages by workspace link:
#
#   docker build -f apps/voice-service/Dockerfile -t luke-voice-service .
#
# The root .dockerignore keeps the context to the manifests, the lockfile,
# the packages' sources, and this app; nothing of the desktop, the site, or
# the iOS tree enters the image.
FROM node:24-alpine

ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate

WORKDIR /luke
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @luke/voice-service...

USER node
WORKDIR /luke/apps/voice-service
EXPOSE 8080
CMD ["./node_modules/.bin/tsx", "src/main.ts"]
