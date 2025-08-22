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
	"github.com/gofiber/swagger"
	"github.com/minio/minio-go/v7"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"gorm.io/gorm"
)

func main() {
	cfg := InitConfig()
	db := ConnectDatabase(cfg)
	MigrateDatabase(db)

	minioClient := InitMinIOClient(cfg)
	redisClient := InitRedisClient(cfg)

	// Initialize services
	objectRepo := repository.NewObjectRepository(db)
	objectService := services.NewObjectService(objectRepo, minioClient, cfg.MinioBucket, cfg)

	// Initialize optimized multi-layer cache service
	cacheService := services.NewCacheService(redisClient, minioClient, cfg.MinioBucket, cfg.CacheTTL)

	// Initialize handlers
	predictionHandler := handlers.NewPredictionHandler(objectService)
	cacheHandler := handlers.NewCacheHandler(cacheService, objectService)
	objectHandler := handlers.NewObjectHandler(objectService, cacheService)

	app := fiber.New(fiber.Config{
		BodyLimit:         500 * 1024 * 1024, // 500 MB
		ReadTimeout:       5 * time.Minute,
		WriteTimeout:      5 * time.Minute,
		ServerHeader:      "Storage Service v2.0 (Optimized)",
		DisableKeepalive:  false,
		StreamRequestBody: true, // Enable streaming for better performance
	})

	// Enhanced Logger Middleware with cache information
	app.Use(logger.New(logger.Config{
		Format:     "[${time}] ${status} - ${method} ${path} ${query} - ${ip} - ${latency} - ${header:x-download-source} - ${header:x-cache-strategy}\n",
		TimeFormat: "2006-01-02 15:04:05",
		Output:     os.Stdout,
	}))

	// Register Prometheus metrics endpoint
	app.Get("/metrics", adaptor.HTTPHandler(promhttp.Handler()))

	// Enhanced Health check endpoint with cache status
	app.Get("/health", func(c *fiber.Ctx) error {
		// Quick cache health check
		cacheHealth := "unknown"
		if stats, err := cacheService.GetStatistics(); err == nil {
			totalObjects := stats.MultiLayer.Memory.Objects + stats.MultiLayer.FileSystem.Objects + stats.MultiLayer.Redis.Objects
			if totalObjects > 0 {
				cacheHealth = "active"
			} else {
				cacheHealth = "empty"
			}
		}

		return c.JSON(fiber.Map{
			"status":      "healthy",
			"version":     "2.0-optimized",
			"cacheHealth": cacheHealth,
			"timestamp":   time.Now(),
		})
	})

	// API routes
	api := app.Group("/api/storage")

	// Prediction routes
	api.Post("/predict", predictionHandler.GetPredictedModels)

	// Object routes (using optimized handler)
	api.Get("/objects", objectHandler.ListObjects)
	api.Get("/objects/:id", objectHandler.GetObject)
	api.Post("/objects/upload", objectHandler.UploadObject)
	api.Delete("/objects/:id", objectHandler.DeleteObject)
	api.Get("/objects/:id/download", objectHandler.DownloadObject) // Optimized download with multi-layer caching

	// Enhanced Cache routes with multi-layer support
	cacheGroup := app.Group("/cache")

	// Preloading
	cacheGroup.Post("/preload", cacheHandler.PreloadObjects) // Intelligent multi-layer preloading

	// Cache management
	cacheGroup.Delete("/object/:id", cacheHandler.InvalidateObject) // Invalidate from all layers

	// Swagger documentation
	app.Get("/swagger/*", swagger.New(swagger.Config{
		URL:          "/swagger/doc.json",
		DeepLinking:  false,
		DocExpansion: "list",
		OAuth: &swagger.OAuthConfig{
			AppName: "Storage Service API v2.0",
		},
	}))

	// Log registered routes with descriptions
	routes := app.GetRoutes()
	log.Println("Registered routes (Storage Service v2.0 with Optimized Multi-Layer Caching):")
	routeDescriptions := map[string]string{
		"GET /api/storage/objects/:id/download": "Multi-layer caching (Memory→FileSystem→Redis→MinIO)",
		"POST /cache/preload":                   "Intelligent multi-layer preloading",
		"GET /cache/stats":                      "Comprehensive cache statistics",
		"GET /health":                           "Health check with cache status",
	}

	for _, r := range routes {
		description := routeDescriptions[r.Method+" "+r.Path]
		if description != "" {
			log.Printf("  %s %s - %s\n", r.Method, r.Path, description)
		} else {
			log.Printf("  %s %s\n", r.Method, r.Path)
		}
	}

	// Log cache strategy configuration
	log.Println("\nOptimized Cache Strategy Configuration:")
	log.Printf("  Layer 1 (Memory):     Files ≤ %d MB (up to 1GB total)", services.SmallFileThreshold/(1024*1024))
	log.Printf("  Layer 2 (FileSystem): Files ≤ %d MB (up to 5GB total)", services.MediumFileThreshold/(1024*1024))
	log.Printf("  Layer 3 (Redis):      Files ≤ %d MB (configurable total)", services.LargeFileThreshold/(1024*1024))
	log.Printf("  Layer 4 (MinIO):      Direct access for files > %d MB", services.LargeFileThreshold/(1024*1024))

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

// Existing helper functions remain the same but with enhanced logging

func InitConfig() *config.Config {
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Config error: %v", err)
	}

	log.Printf("Configuration loaded:")
	log.Printf("  Cache TTL: %v", cfg.CacheTTL)
	log.Printf("  Redis: %s:%s", cfg.RedisHost, cfg.RedisPort)
	log.Printf("  MinIO: %s", cfg.MinioEndpoint)

	return cfg
}

func ConnectDatabase(cfg *config.Config) *gorm.DB {
	db, err := config.ConnectDatabase(cfg)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	log.Printf("Database connected: %s:%s/%s", cfg.DBHost, cfg.DBPort, cfg.DBName)
	return db
}

func MigrateDatabase(db *gorm.DB) {
	err := db.AutoMigrate(&models.Object{})
	if err != nil {
		log.Fatalf("Failed to migrate database: %v", err)
	}

	// Ensure spatial indexes exist for prediction queries
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_objects_lat_lon ON objects (latitude, longitude)`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_objects_lat ON objects (latitude)`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_objects_lon ON objects (longitude)`)

	log.Printf("Database migration completed with spatial indexes")
}

func InitMinIOClient(cfg *config.Config) *minio.Client {
	minioClient, err := storage.NewMinioClient(cfg)
	if err != nil {
		log.Fatalf("Failed to initialize MinIO client: %v", err)
	}
	log.Printf("MinIO client initialized: %s (bucket: %s)", cfg.MinioEndpoint, cfg.MinioBucket)
	return minioClient
}

func InitRedisClient(cfg *config.Config) *storage.RedisClient {
	redisClient, err := storage.NewRedisClient(cfg.RedisHost, cfg.RedisPort)
	if err != nil {
		log.Fatalf("Failed to initialize Redis client: %v", err)
	}
	log.Printf("Redis client initialized: %s:%s", cfg.RedisHost, cfg.RedisPort)
	return redisClient
}
