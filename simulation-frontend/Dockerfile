# 1) Build with Node & Vite
FROM node:18-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY tsconfig.json vite.config.mjs ./
COPY public ./public
COPY public/index.html ./
COPY src ./src
RUN npm install
RUN npm run build

# 2) Serve the static build with nginx
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]