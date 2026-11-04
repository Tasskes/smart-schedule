# --- сборка приложения (PWA) ---
FROM node:22-slim AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npm run build

# --- сервер ---
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server/ ./
COPY --from=client /app/client/dist /app/client/dist
ENV DATA_DIR=/data STATIC_DIR=/app/client/dist PORT=8080
VOLUME /data
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
