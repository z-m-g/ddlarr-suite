FROM node:20-alpine

# Set UTF-8 locale
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# Install curl and wget for direct download clients
RUN apk add --no-cache curl wget

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Copy public folder to dist
RUN cp -r public dist/

EXPOSE 9118

CMD ["npm", "start"]
