# Build stage for UI
FROM node:20-alpine AS ui-builder
WORKDIR /app/ui
COPY ui/package*.json ./
RUN npm install
COPY ui/ ./
RUN npm run build

# Build stage for backend
FROM node:20-alpine AS backend-builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY src ./src
COPY tsconfig.json ./
RUN npm run build

# Production image
FROM node:20-alpine
WORKDIR /app

# Install curl for downloads
RUN apk add --no-cache curl wget

# Copy built files
COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=ui-builder /app/ui/dist ./public
COPY package.json ./

# Create data directory
RUN mkdir -p /data /downloads /downloads-temp

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_PATH=/data
ENV DOWNLOAD_PATH=/downloads
ENV TEMP_PATH=/downloads-temp

EXPOSE 8080

CMD ["node", "dist/index.js"]
