FROM node:22.23-alpine
WORKDIR /app

# install dependencies first, so Docker can reuse this layer when only your code changes
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
ENV NODE_ENV=production
# Run as the image's normal user "node", not root. The files above belong to root, so the app can read
# them but cannot change them: a bug that lets an attacker run code cannot rewrite the app.
USER node
EXPOSE 3000
CMD ["node", "server.js"]