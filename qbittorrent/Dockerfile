# Build stage for UI
FROM node:22-alpine AS ui-builder
WORKDIR /app/ui
COPY ui/package*.json ./
RUN npm ci
COPY ui/ ./
RUN npm run build

# Build stage for backend
FROM node:22-alpine AS backend-builder
WORKDIR /app
# better-sqlite3 ships no prebuilt binary for Alpine (musl): it is compiled here,
# and the resulting node_modules is copied into the production image below
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci
COPY src ./src
COPY tsconfig.json ./
RUN npm run build

# Production image
FROM node:22-alpine
WORKDIR /app

# Install curl for downloads and extraction tools
# Note: unrar is no longer available in Alpine, using libarchive-tools (bsdtar) for RAR support
RUN apk add --no-cache curl wget unzip p7zip libarchive-tools

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
ENV AUTO_EXTRACT_ARCHIVE=1
ENV AUTO_REMOVE_COMPLETED_AFTER=0

EXPOSE 8080

CMD ["node", "dist/index.js"]
