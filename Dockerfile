FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY index.html vite.config.js ./
COPY css ./css
COPY js ./js
COPY src ./src
COPY data ./data
COPY scripts ./scripts
RUN npm run build

FROM nginx:1.27-alpine

RUN apk add --no-cache gettext

WORKDIR /usr/share/nginx/html

RUN mkdir -p /usr/share/nginx/html/js

COPY --from=build /app/dist ./
COPY --from=build /app/data ./data
COPY docs.html ./
COPY js/runtime-config.template.js ./js/runtime-config.template.js
COPY nginx.conf /etc/nginx/conf.d/default.conf.template

EXPOSE 8080

CMD ["/bin/sh", "-c", "set -eu; cp /etc/nginx/conf.d/default.conf.template /etc/nginx/conf.d/default.conf; sed -i \"s/listen 80;/listen ${PORT:-8080};/\" /etc/nginx/conf.d/default.conf; envsubst '${BAZUNIA_CONVEX_URL} ${BAZA_CONVEX_URL} ${BAZUNIA_PUBLIC_DECK_PROVIDER}' < /usr/share/nginx/html/js/runtime-config.template.js > /tmp/runtime-config.js; exec nginx -g 'daemon off;'"]
