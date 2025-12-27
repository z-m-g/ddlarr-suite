# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy built files and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

# Create cache directory
RUN mkdir -p /app/cache

ENV NODE_ENV=production
ENV PORT=9117
ENV HOST=0.0.0.0
ENV CACHE_DIR=/app/cache

EXPOSE 9117

CMD ["node", "dist/index.js"]
