FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
ENV FILE_READER_ROOT=/app/workspace
ENV LOG_LEVEL=info
CMD ["node", "dist/index.js"]
