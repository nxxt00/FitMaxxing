FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package*.json ./
ENV BETTER_SQLITE3_BUILD_FROM_SOURCE=1
RUN npm install --omit=dev

COPY backend/ ./
COPY frontend/ ./frontend/

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]