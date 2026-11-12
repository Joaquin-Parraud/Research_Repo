FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# The official image renders /etc/nginx/templates/*.template into /etc/nginx/conf.d/ with
# envsubst on start. The filter limits substitution to MAX_UPLOAD_MB, so nginx's own
# $variables in the config survive.
ENV MAX_UPLOAD_MB=200 \
    NGINX_ENVSUBST_FILTER=^MAX_UPLOAD_MB$
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
