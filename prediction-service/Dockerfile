FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./

ARG PORT
ENV PORT=${PORT:-3000}

RUN npm ci
COPY src ./src
RUN npx tsc

# Final stage: minimal runtime image
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=development
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE ${PORT}
CMD ["node", "dist/index.js"]