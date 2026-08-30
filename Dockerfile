FROM node:18-alpine

WORKDIR /app

# Copy backend files
COPY backend/package.json ./
RUN npm install

COPY backend/ ./

# Copy frontend files
COPY frontend/ ./frontend/

EXPOSE 3000

CMD ["node", "server.js"]