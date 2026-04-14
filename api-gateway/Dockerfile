FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=15 \
  CMD wget -qO- http://localhost:3000/health || exit 1

USER node

CMD ["node", "src/index.js"]
