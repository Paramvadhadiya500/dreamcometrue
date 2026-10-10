FROM node:22-alpine
WORKDIR /app

# install dependencies first, so Docker can reuse this layer when only your code changes
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]