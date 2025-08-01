package config

import (
	"fmt"
	"os"
	"strconv"

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

	// Prediction settings
	PredictionRadius     float64 // Default radius in meters for object prediction (default: 30)
	UseDirectionalFilter bool    // Whether to apply directional/frustum filtering
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

	predictionRadius := 30.0 // default value
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
		AppPort:              getEnvWithDefault("APP_PORT", "8000"),
		DBHost:               getEnvWithDefault("DB_HOST", "localhost"),
		DBPort:               getEnvWithDefault("DB_PORT", "5432"),
		DBUser:               getEnvWithDefault("DB_USER", "postgres"),
		DBPassword:           getEnvWithDefault("DB_PASSWORD", ""),
		DBName:               getEnvWithDefault("DB_NAME", "storage_db"),
		MinioEndpoint:        getEnvWithDefault("MINIO_ENDPOINT", "localhost:9000"),
		MinioAccessKey:       getEnvWithDefault("MINIO_ACCESS_KEY", "minioadmin"),
		MinioSecretKey:       getEnvWithDefault("MINIO_SECRET_KEY", "minioadmin"),
		MinioBucket:          getEnvWithDefault("MINIO_BUCKET", "storage-bucket"),
		MinioSSL:             minioSSL,
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

// ConnectDatabase initializes a GORM database connection to PostgreSQL.
func ConnectDatabase(cfg *Config) (*gorm.DB, error) {
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		cfg.DBHost, cfg.DBPort, cfg.DBUser, cfg.DBPassword, cfg.DBName)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		return nil, err
	}
	return db, nil
}
