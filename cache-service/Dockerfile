FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN chmod +x node_modules/.bin/* || true
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app

# Nur Prod-Dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Nur den Build-Output kopieren (und evtl. nötige Assets/Configs)
COPY --from=builder /app/dist ./dist

EXPOSE 8001
CMD ["node", "dist/index.js"]