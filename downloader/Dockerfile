FROM node:20-alpine

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
