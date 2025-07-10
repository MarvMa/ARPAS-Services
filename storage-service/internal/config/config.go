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
	cfg := &Config{
		AppPort:        os.Getenv("STORAGE_PORT"),
		DBHost:         os.Getenv("DB_HOST"),
		DBPort:         os.Getenv("DB_PORT"),
		DBUser:         os.Getenv("DB_USER"),
		DBPassword:     os.Getenv("DB_PASSWORD"),
		DBName:         os.Getenv("DB_NAME"),
		MinioEndpoint:  os.Getenv("MINIO_ENDPOINT"),
		MinioAccessKey: os.Getenv("MINIO_ACCESS_KEY"),
		MinioSecretKey: os.Getenv("MINIO_SECRET_KEY"),
		MinioBucket:    os.Getenv("MINIO_BUCKET"),
		MinioSSL:       minioSSL,

		// Prediction settings
		PredictionRadius:     predictionRadius,
		UseDirectionalFilter: useDirectionalFilter,
	}
	// Basic validation for required fields
	if cfg.DBHost == "" || cfg.DBUser == "" || cfg.DBName == "" {
		return nil, fmt.Errorf("database configuration is incomplete")
	}
	if cfg.MinioEndpoint == "" || cfg.MinioAccessKey == "" || cfg.MinioSecretKey == "" || cfg.MinioBucket == "" {
		return nil, fmt.Errorf("minio configuration is incomplete")
	}
	return cfg, nil
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
