FROM node:20-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && apt-get purge -y python3 make g++ && apt-get autoremove -y
COPY server.js db.js gloss.js ai.js collab.js ./
COPY routes ./routes
COPY migrations ./migrations
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data
EXPOSE 3748
CMD ["node", "server.js"]
