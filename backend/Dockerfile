FROM node:20-alpine

# Install ffmpeg
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY server.js .

RUN mkdir -p /app/thumbnails

ENV VIDEO_DIR=/videos
ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "server.js"]
