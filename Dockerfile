FROM node:lts-alpine

RUN rm -rf /var/cache/apk/*

RUN npm i -g pnpm

WORKDIR /app

COPY bin /app/bin
COPY dist /app/dist

COPY package.json /app/package.json

COPY pnpm-lock.yaml /app/pnpm-lock.yaml

RUN pnpm install -P --frozen-lockfile

CMD [ "node", "/app/bin/polymine"]
