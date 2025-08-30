package config

import (
	"fmt"
	"os"
	"strconv"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Config holds all configuration values from environment.
type Config struct {
	AppPort    string
	DBHost     string
	DBPort     string
	DBUser     string
	DBPassword string
	DBName     string

	// MinIO configuration
	MinioEndpoint  string
	MinioAccessKey string
	MinioSecretKey string
	MinioBucket    string
	MinioSSL       bool

	// Redis configuration
	RedisHost string
	RedisPort string

	// Cache configuration
	CacheEnabled      bool
	CacheMaxSizeBytes int64
	CacheTTL          time.Duration

	// Prediction settings
	PredictionRadius     float64
	UseDirectionalFilter bool
}

// LoadConfig loads configuration from environment variables.
func LoadConfig() (*Config, error) {
	// Parse MinIO SSL setting
	minioSSL := false
	if sslEnv := os.Getenv("MINIO_SSL"); sslEnv != "" {
		val, err := strconv.ParseBool(sslEnv)
		if err != nil {
			return nil, fmt.Errorf("invalid MINIO_SSL value: %v", err)
		}
		minioSSL = val
	}

	// Parse cache enabled setting
	cacheEnabled := true
	if cacheEnv := os.Getenv("CACHE_ENABLED"); cacheEnv != "" {
		val, err := strconv.ParseBool(cacheEnv)
		if err == nil {
			cacheEnabled = val
		}
	}

	// Parse cache max size (default 8GB)
	cacheMaxSize := int64(8 << 30) // 8GB default
	if sizeEnv := os.Getenv("CACHE_MAX_SIZE_GB"); sizeEnv != "" {
		if gb, err := strconv.ParseInt(sizeEnv, 10, 64); err == nil {
			cacheMaxSize = gb << 30
		}
	}

	// Parse cache TTL (default 1 hour)
	cacheTTL := time.Hour
	if ttlEnv := os.Getenv("CACHE_TTL_MINUTES"); ttlEnv != "" {
		if minutes, err := strconv.ParseInt(ttlEnv, 10, 64); err == nil {
			cacheTTL = time.Duration(minutes) * time.Minute
		}
	}

	// Parse prediction radius (default 20 meters)
	predictionRadius := 20.0
	if radiusEnv := os.Getenv("PREDICTION_RADIUS"); radiusEnv != "" {
		val, err := strconv.ParseFloat(radiusEnv, 64)
		if err == nil {
			predictionRadius = val
		}
	}

	// Parse directional filter setting
	useDirectionalFilter := false
	if filterEnv := os.Getenv("USE_DIRECTIONAL_FILTER"); filterEnv != "" {
		val, err := strconv.ParseBool(filterEnv)
		if err == nil {
			useDirectionalFilter = val
		}
	}

	config := &Config{
		// Application
		AppPort: getEnvWithDefault("APP_PORT", "8000"),

		// Database
		DBHost:     getEnvWithDefault("DB_HOST", "localhost"),
		DBPort:     getEnvWithDefault("DB_PORT", "5432"),
		DBUser:     getEnvWithDefault("DB_USER", "postgres"),
		DBPassword: getEnvWithDefault("DB_PASSWORD", ""),
		DBName:     getEnvWithDefault("DB_NAME", "storage_db"),

		// MinIO
		MinioEndpoint:  getEnvWithDefault("MINIO_ENDPOINT", "localhost:9000"),
		MinioAccessKey: getEnvWithDefault("MINIO_ACCESS_KEY", "minioadmin"),
		MinioSecretKey: getEnvWithDefault("MINIO_SECRET_KEY", "minioadmin"),
		MinioBucket:    getEnvWithDefault("MINIO_BUCKET", "storage-bucket"),
		MinioSSL:       minioSSL,

		// Cache
		CacheEnabled:      cacheEnabled,
		CacheMaxSizeBytes: cacheMaxSize,
		CacheTTL:          cacheTTL,

		// Prediction
		PredictionRadius:     predictionRadius,
		UseDirectionalFilter: useDirectionalFilter,
	}

	return config, nil
}

func getEnvWithDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func ConnectDatabase(cfg *Config) (*gorm.DB, error) {
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		cfg.DBHost, cfg.DBPort, cfg.DBUser, cfg.DBPassword, cfg.DBName)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		PrepareStmt:            true,
		SkipDefaultTransaction: true,
	})
	if err != nil {
		return nil, err
	}

	sqlDB, err := db.DB()
	if err == nil {
		sqlDB.SetMaxOpenConns(10)
		sqlDB.SetMaxIdleConns(5)
		sqlDB.SetConnMaxLifetime(30 * time.Minute)
		sqlDB.SetConnMaxIdleTime(5 * time.Minute)
	}
	return db, nil
}
