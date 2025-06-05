FROM golang:1.24.3 AS builder

WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Install swag for swagger generation
RUN go install github.com/swaggo/swag/cmd/swag@latest

# Copy source code
COPY . .

# Generate swagger documentation
RUN swag init -g cmd/main.go -o ./docs --parseDependency --parseInternal

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -o storage-service ./cmd/main.go

# Final stage
FROM alpine:3
RUN apk add --no-cache ca-certificates wget

WORKDIR /

# Copy the binary and swagger docs
COPY --from=builder /app/storage-service /storage-service
COPY --from=builder /app/docs /docs

EXPOSE 8080

ENTRYPOINT ["/storage-service"]