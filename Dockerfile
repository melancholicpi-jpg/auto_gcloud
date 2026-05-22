FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY user-panel/ ./user-panel/
COPY templates/ ./templates/

RUN mkdir -p /tmp/uploads

ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "user-panel/server.js"]
