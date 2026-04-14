FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src/ ./src/

EXPOSE 9000

HEALTHCHECK --interval=5s --timeout=3s --retries=10 \
  CMD node -e "require('http').get('http://localhost:9000/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

USER node

CMD ["node", "src/index.js"]
