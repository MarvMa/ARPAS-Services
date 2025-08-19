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
	AppPort        string
	DBHost         string
	DBPort         string
	DBUser         string
	DBPassword     string
	DBName         string
	MinioEndpoint  string
	MinioAccessKey string
	MinioSecretKey string
	MinioBucket    string
	MinioSSL       bool

	// Redis configuration
	RedisHost string
	RedisPort string

	// Cache configuration
	CacheServiceURL string
	CacheEnabled    bool
	CacheTTL        time.Duration

	// Prediction settings
	PredictionRadius     float64
	UseDirectionalFilter bool
}

// LoadConfig loads configuration from environment variables.
func LoadConfig() (*Config, error) {
	minioSSL := false
	if sslEnv := os.Getenv("MINIO_SSL"); sslEnv != "" {
		val, err := strconv.ParseBool(sslEnv)
		if err != nil {
			return nil, fmt.Errorf("invalid MINIO_SSL value: %v", err)
		}
		minioSSL = val
	}

	cacheEnabled := true
	if cacheEnv := os.Getenv("CACHE_ENABLED"); cacheEnv != "" {
		val, err := strconv.ParseBool(cacheEnv)
		if err == nil {
			cacheEnabled = val
		}
	}

	predictionRadius := 20.0 // default value
	if radiusEnv := os.Getenv("PREDICTION_RADIUS"); radiusEnv != "" {
		val, err := strconv.ParseFloat(radiusEnv, 64)
		if err == nil {
			predictionRadius = val
		}
	}

	useDirectionalFilter := false
	if filterEnv := os.Getenv("USE_DIRECTIONAL_FILTER"); filterEnv != "" {
		val, err := strconv.ParseBool(filterEnv)
		if err == nil {
			useDirectionalFilter = val
		}
	}

	config := &Config{
		AppPort:              getEnvWithDefaultString("APP_PORT", "8000"),
		DBHost:               getEnvWithDefaultString("DB_HOST", "localhost"),
		DBPort:               getEnvWithDefaultString("DB_PORT", "5432"),
		DBUser:               getEnvWithDefaultString("DB_USER", "postgres"),
		DBPassword:           getEnvWithDefaultString("DB_PASSWORD", ""),
		DBName:               getEnvWithDefaultString("DB_NAME", "storage_db"),
		MinioEndpoint:        getEnvWithDefaultString("MINIO_ENDPOINT", "localhost:9000"),
		MinioAccessKey:       getEnvWithDefaultString("MINIO_ACCESS_KEY", "minioadmin"),
		MinioSecretKey:       getEnvWithDefaultString("MINIO_SECRET_KEY", "minioadmin"),
		MinioBucket:          getEnvWithDefaultString("MINIO_BUCKET", "storage-bucket"),
		MinioSSL:             minioSSL,
		CacheServiceURL:      getEnvWithDefaultString("CACHE_URL", "http://cache-service:8001"),
		CacheEnabled:         cacheEnabled,
		PredictionRadius:     predictionRadius,
		UseDirectionalFilter: useDirectionalFilter,
		RedisHost:            getEnvWithDefaultString("REDIS_HOST", "localhost"),
		RedisPort:            getEnvWithDefaultString("REDIS_PORT", "6379"),
	}

	return config, nil
}

func getEnvWithDefaultString(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// ConnectDatabase initializes a GORM database connection to PostgreSQL.
func ConnectDatabase(cfg *Config) (*gorm.DB, error) {
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		cfg.DBHost, cfg.DBPort, cfg.DBUser, cfg.DBPassword, cfg.DBName)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		PrepareStmt: true,
	})
	if err != nil {
		return nil, err
	}

	sqlDB, err := db.DB()
	if err == nil {
		sqlDB.SetMaxOpenConns(25)
		sqlDB.SetMaxIdleConns(25)
		sqlDB.SetConnMaxLifetime(30 * time.Minute)
		sqlDB.SetConnMaxIdleTime(5 * time.Minute)
	}
	return db, nil

}
