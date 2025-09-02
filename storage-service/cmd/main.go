// storage-service/cmd/main.go
package main

import (
	"log"
	"net/http"
	_ "net/http/pprof"
	"os"
	"runtime"
	"storage-service/internal/config"
	"storage-service/internal/handlers"
	"storage-service/internal/models"
	"storage-service/internal/repository"
	"storage-service/internal/services"
	"storage-service/internal/services/caches"
	"storage-service/internal/storage"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/adaptor"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/minio/minio-go/v7"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"gorm.io/gorm"
)

func main() {
	// Performance tuning for Go runtime
	runtime.GOMAXPROCS(runtime.NumCPU())
	runtime.SetBlockProfileRate(0)
	runtime.SetMutexProfileFraction(0)

	go func() {
		log.Println("pprof server:", http.ListenAndServe("localhost:6060", nil))
	}()

	cfg := InitConfig()
	db := ConnectDatabase(cfg)
	MigrateDatabase(db)

	minioClient := InitMinIOClient(cfg)

	objectRepo := repository.NewObjectRepository(db)
	objectService := services.NewObjectService(objectRepo, minioClient, cfg.MinioBucket, cfg)

	// Determine cache type from environment variable
	cacheType := determineCacheType()

	// Initialize high-performance cache service with selected implementation
	var cacheService *services.CacheService

	switch cacheType {
	case caches.CacheTypeSharded:
		log.Printf("Using SHARDED cache implementation (best for high concurrency)")
		cacheService = services.NewCacheServiceWithType(
			minioClient,
			cfg.MinioBucket,
			cfg.CacheMaxSizeBytes,
			cfg.CacheTTL,
			caches.CacheTypeSharded,
		)
	case caches.CacheTypeLRU:
		log.Printf("Using LRU cache implementation (simple and reliable)")
		cacheService = services.NewCacheServiceWithType(
			minioClient,
			cfg.MinioBucket,
			cfg.CacheMaxSizeBytes,
			cfg.CacheTTL,
			caches.CacheTypeLRU,
		)
	case caches.CacheTypeRistretto:
		log.Printf("Using RISTRETTO cache implementation (advanced admission policy)")
		cacheService = services.NewCacheServiceWithType(
			minioClient,
			cfg.MinioBucket,
			cfg.CacheMaxSizeBytes,
			cfg.CacheTTL,
			caches.CacheTypeRistretto,
		)
	default:
		log.Printf("Using default SHARDED cache implementation")
		cacheService = services.NewCacheService(
			minioClient,
			cfg.MinioBucket,
			cfg.CacheMaxSizeBytes,
			cfg.CacheTTL,
		)
	}

	// Initialize handlers
	cacheHandler := handlers.NewCacheHandler(cacheService, objectService)
	objectHandler := handlers.NewObjectHandler(objectService, cacheService)

	// Configure Fiber for maximum performance
	app := fiber.New(fiber.Config{
		BodyLimit:                500 * 1024 * 1024, // 500 MB
		ReadTimeout:              5 * time.Minute,
		WriteTimeout:             5 * time.Minute,
		IdleTimeout:              120 * time.Second,
		ReadBufferSize:           8192,
		WriteBufferSize:          8192,
		CompressedFileSuffix:     ".gz",
		ServerHeader:             "Storage Service v3.0 (High-Performance)",
		DisableKeepalive:         false,
		DisableDefaultDate:       true,
		DisableHeaderNormalizing: true,
		StreamRequestBody:        true,
		Concurrency:              256 * 1024, // Max concurrent connections
		DisableStartupMessage:    false,
	})

	// Optimized logger configuration
	app.Use(logger.New(logger.Config{
		Format: "[${time}] ${status} - ${method} ${path} - ${latency} - " +
			"Mode:${header:x-optimization-mode} Cache:${header:x-cache-hit}\n",
		TimeFormat:    "15:04:05.000",
		Output:        os.Stdout,
		DisableColors: true, // Slightly faster without colors
	}))

	// Register Prometheus metrics endpoint
	app.Get("/metrics", adaptor.HTTPHandler(promhttp.Handler()))

	// Health check endpoint
	app.Get("/health", func(c *fiber.Ctx) error {

		return c.JSON(fiber.Map{
			"status": "healthy",
		})
	})

	// API routes
	api := app.Group("/api/storage")

	// Object management endpoints
	api.Get("/objects", objectHandler.ListObjects)
	api.Get("/objects/:id", objectHandler.GetObject)
	api.Post("/objects/upload", objectHandler.UploadObject)
	api.Delete("/objects/:id", objectHandler.DeleteObject)

	// Optimized download endpoint
	api.Get("/objects/:id/download", objectHandler.DownloadObject)

	// Cache management endpoints
	cacheGroup := app.Group("/cache")
	cacheGroup.Post("/preload", cacheHandler.PreloadObjects)
	cacheGroup.Post("/preload-all", cacheHandler.PreloadAll)
	cacheGroup.Delete("/object/:id", cacheHandler.InvalidateObject)
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

	log.Printf("Starting High-Performance Storage Service")
	log.Printf("Port: %s", port)
	log.Printf("Cache Implementation: %s", strings.ToUpper(string(cacheType)))
	log.Printf("Cache Size: %.2f MB", float64(cfg.CacheMaxSizeBytes)/(1024*1024))
	log.Printf("Cache TTL: %v", cfg.CacheTTL)
	log.Printf("Cache Enabled: %v", cfg.CacheEnabled)
	log.Printf("Runtime GOMAXPROCS: %d", runtime.GOMAXPROCS(0))
	log.Printf("========================================")

	if err := app.Listen(":" + port); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}

// determineCacheType reads the cache type from environment variable
func determineCacheType() caches.CacheType {
	cacheTypeEnv := strings.ToLower(os.Getenv("CACHE_TYPE"))

	switch cacheTypeEnv {
	case "sharded":
		return caches.CacheTypeSharded
	case "lru":
		return caches.CacheTypeLRU
	case "ristretto":
		return caches.CacheTypeRistretto
	default:
		return caches.CacheTypeSharded
	}
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

	// Create optimized indexes for spatial queries
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_objects_lat_lon ON objects (latitude, longitude)`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_objects_lat ON objects (latitude)`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_objects_lon ON objects (longitude)`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_objects_storage_key ON objects (storage_key)`)
}

func InitMinIOClient(cfg *config.Config) *minio.Client {
	minioClient, err := storage.NewMinioClient(cfg)
	if err != nil {
		log.Fatalf("Failed to initialize MinIO client: %v", err)
	}
	return minioClient
}
