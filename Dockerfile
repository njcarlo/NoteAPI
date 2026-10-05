# One image for the API, the notification worker and migrations (choose with the command).
#   API:        node dist/server.js        (default)
#   Worker:     node dist/worker.js
#   Migrations: node dist/db/migrate.js

FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --filter @clinic/api...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @clinic/api build \
 && pnpm --filter @clinic/api deploy --legacy --prod /out

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
