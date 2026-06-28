FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4022
ENV RENDER_ENGINE=auto

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force \
  && npx playwright install-deps chromium \
  && npx playwright install chromium

COPY --from=build /app/dist ./dist
COPY registry ./registry

EXPOSE 4022

HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4022)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/src/index.js"]
