FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Chỉ bật cho bản demo (backend vẫn phải có DEV_LOGIN_ENABLED=true); Vite đọc lúc build.
ARG VITE_ENABLE_DEV_LOGIN
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
