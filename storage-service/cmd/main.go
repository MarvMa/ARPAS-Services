package main

import (
	"log"
	"os"
	"storage-service/internal/config"
	"storage-service/internal/handlers"
	"storage-service/internal/models"
	"storage-service/internal/repository"
	"storage-service/internal/services"
	"storage-service/internal/storage"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/adaptor"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/minio/minio-go/v7"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"gorm.io/gorm"
)

func main() {
	cfg := InitConfig()
	db := ConnectDatabase(cfg)
	MigrateDatabase(db)

	minioClient := InitMinIOClient(cfg)

	objectRepo := repository.NewObjectRepository(db)
	objectService := services.NewObjectService(objectRepo, minioClient, cfg.MinioBucket, cfg)
	cacheService := services.NewCacheService(
		minioClient,
		cfg.MinioBucket,
		cfg.CacheMaxSizeBytes,
		cfg.CacheTTL,
	)

	// Initialize handlers
	cacheHandler := handlers.NewCacheHandler(cacheService, objectService)
	objectHandler := handlers.NewObjectHandler(objectService, cacheService)

	app := fiber.New(fiber.Config{
		BodyLimit:         500 * 1024 * 1024, // 500 MB
		ReadTimeout:       5 * time.Minute,
		WriteTimeout:      5 * time.Minute,
		ServerHeader:      "Storage Service v2.0 (Instrumented)",
		DisableKeepalive:  false,
		StreamRequestBody: true,
	})

	app.Use(logger.New(logger.Config{
		Format: "[${time}] ${status} - ${method} ${path} ${query} - ${ip} - ${latency} - " +
			"Cache:${header:x-cache-hit} Layer:${header:x-cache-layer-used} " +
			"TotalMs:${header:x-latency-total-ms} FirstByteMs:${header:x-latency-first-byte-ms}\n",
		TimeFormat: "2006-01-02 15:04:05",
		Output:     os.Stdout,
	}))

	// Register Prometheus metrics endpoint
	app.Get("/metrics", adaptor.HTTPHandler(promhttp.Handler()))

	// Enhanced Health check endpoint
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status":    "healthy",
			"version":   "2.0-instrumented",
			"timestamp": time.Now(),
		})
	})

	// API routes
	api := app.Group("/api/storage")

	api.Get("/objects", objectHandler.ListObjects)
	api.Get("/objects/:id", objectHandler.GetObject)
	api.Post("/objects/upload", objectHandler.UploadObject)
	api.Delete("/objects/:id", objectHandler.DeleteObject)
	api.Get("/objects/:id/download", objectHandler.DownloadObject)

	cacheGroup := app.Group("/cache")
	cacheGroup.Post("/preload", cacheHandler.PreloadObjects)
	cacheGroup.Post("/preload-all", cacheHandler.PreloadAll)
	cacheGroup.Delete("/object/:id", cacheHandler.InvalidateObject)
	cacheGroup.Get("/stats", cacheHandler.GetCacheStats)
	cacheGroup.Post("/clear", cacheHandler.ClearCache)

	// Start the server
	port := os.Getenv("STORAGE_PORT")
	if port == "" {
		port = cfg.AppPort
		if port == "" {
			port = "8000"
			log.Printf("Defaulting to port %s", port)
		}
	}

	log.Fatal(app.Listen(":" + port))
}

func InitConfig() *config.Config {
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Config error: %v", err)
	}
	return cfg
}

func ConnectDatabase(cfg *config.Config) *gorm.DB {
	db, err := config.ConnectDatabase(cfg)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	return db
}

func MigrateDatabase(db *gorm.DB) {
	err := db.AutoMigrate(&models.Object{})
	if err != nil {
		log.Fatalf("Failed to migrate database: %v", err)
	}
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_objects_lat_lon ON objects (latitude, longitude)`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_objects_lat ON objects (latitude)`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_objects_lon ON objects (longitude)`)
}

func InitMinIOClient(cfg *config.Config) *minio.Client {
	minioClient, err := storage.NewMinioClient(cfg)
	if err != nil {
		log.Fatalf("Failed to initialize MinIO client: %v", err)
	}
	return minioClient
}
