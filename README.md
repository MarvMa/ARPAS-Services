# ARPAS-Services

## Storage Service

## Interface Documentation

### Swagger UI

#### Storage-Service

Generate Swagger-Docs for the Storage Service.

```shell+
cd storage-service
swag init --generalInfo cmd/main.go --output docs
```

Open the Swagger UI in your browser:

```shell+
http://localhost:8080/api/storage/swagger/index.html
```