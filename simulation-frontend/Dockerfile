# Build stage
FROM node:alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:alpine

WORKDIR /app

# Install serve to serve the static files
RUN npm install -g serve

# Copy build files
COPY --from=builder /app/dist /app/dist

# Create a simple health check endpoint
RUN echo '<!DOCTYPE html><html><head><title>Health</title></head><body>OK</body></html>' > /app/dist/health

# Expose port 3000
EXPOSE 3000

# Add health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the server on port 3000
CMD ["serve", "-s", "dist", "-l", "3000"]
