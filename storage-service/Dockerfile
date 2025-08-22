FROM golang:1.24-alpine AS builder

WORKDIR /app

# Copy go mod files and download dependencies
COPY go.mod go.sum ./
RUN go mod download

# Install swag (Swaggo CLI) for Swagger documentation generation
RUN go install github.com/swaggo/swag/cmd/swag@latest

# Copy source code
COPY . .

# Generate Swagger documentation (outputs to ./docs)
#RUN swag init -g cmd/main.go -o ./docs --parseDependency --parseInternal

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -o storage-service ./cmd/main.go

# Final stage: minimal runtime image
FROM alpine:3
RUN apk add --no-cache assimp ca-certificates wget

WORKDIR /

# Copy the compiled binary and Swagger docs from the builder stage
COPY --from=builder /app/storage-service /storage-service
#COPY --from=builder /app/docs /docs

EXPOSE 8080

ENTRYPOINT ["/storage-service"]
