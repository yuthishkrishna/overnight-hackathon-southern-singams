FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY client ./client

ENV NODE_ENV=production
EXPOSE 5000

USER node
CMD ["npm", "start"]