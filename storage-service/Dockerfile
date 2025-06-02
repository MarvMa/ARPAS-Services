FROM golang:1.24.3 AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o storage-service ./cmd/main.go

FROM alpine:3
# Install ca-certificates for HTTPS
RUN apk add --no-cache ca-certificates

COPY --from=builder /app/storage-service /storage-service

EXPOSE 8080

ENTRYPOINT ["/storage-service"]
