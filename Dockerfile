FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/sn.conf.template
COPY docker-entrypoint.sh /sn-entrypoint.sh
RUN chmod +x /sn-entrypoint.sh
EXPOSE 80
ENTRYPOINT ["/sn-entrypoint.sh"]
