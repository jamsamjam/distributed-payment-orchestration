FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src/ ./src/

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=15 \
  CMD node -e "require('http').get('http://localhost:3000/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

USER node

CMD ["node", "src/index.js"]
