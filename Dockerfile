FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev && npm cache clean --force

COPY index.js swagger_output.json ./
COPY src ./src
COPY scripts ./scripts

USER node

EXPOSE 5003

CMD ["node", "index.js"]
