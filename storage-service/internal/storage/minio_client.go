package storage

import (
	"context"
	"log"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"storage-service/internal/config"
)

// NewMinioClient initializes a MinIO client and ensures the bucket exists.
func NewMinioClient(cfg *config.Config) (*minio.Client, error) {
	// Initialize MinIO client
	minioClient, err := minio.New(cfg.MinioEndpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.MinioAccessKey, cfg.MinioSecretKey, ""),
		Secure: cfg.MinioSSL,
	})
	if err != nil {
		return nil, err
	}
	// Ensure the bucket exists (create if not present)
	ctx := context.Background()
	exists, errBucket := minioClient.BucketExists(ctx, cfg.MinioBucket)
	if errBucket != nil {
		return nil, errBucket
	}
	if !exists {
		err = minioClient.MakeBucket(ctx, cfg.MinioBucket, minio.MakeBucketOptions{Region: ""})
		if err != nil {
			return nil, err
		}
		log.Printf("Created bucket %s\n", cfg.MinioBucket)
	}
	return minioClient, nil
}
