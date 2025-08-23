package services

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"mime/multipart"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/pkg/errors"

	"storage-service/internal/config"
	"storage-service/internal/models"
	"storage-service/internal/repository"
	"storage-service/internal/utils"
)

func newCacheHTTPClient() *http.Client {
	tr := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		MaxIdleConns:          256,
		MaxIdleConnsPerHost:   128,
		IdleConnTimeout:       90 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		DisableCompression:    true,
	}
	return &http.Client{Transport: tr, Timeout: 30 * time.Second}
}

// ObjectService provides methods for managing 3D objects in storage.
type ObjectService struct {
	Repo       *repository.ObjectRepositoryImpl
	Minio      *minio.Client
	BucketName string
	Config     *config.Config
	cacheHTTP  *http.Client
}

// NewObjectService creates a new ObjectService with the given repository and storage client.
func NewObjectService(repo *repository.ObjectRepositoryImpl, minioClient *minio.Client, bucketName string, cfg *config.Config) *ObjectService {
	return &ObjectService{
		Repo:       repo,
		Minio:      minioClient,
		BucketName: bucketName,
		Config:     cfg,
		cacheHTTP:  newCacheHTTPClient(),
	}
}

// CreateObject processes a single GLB file upload and stores it in MinIO.
func (s *ObjectService) CreateObject(fileHeader *multipart.FileHeader, latitude, longitude, altitude *float64) (*models.Object, error) {
	if !strings.HasSuffix(strings.ToLower(fileHeader.Filename), ".glb") {
		return nil, fmt.Errorf("only GLB files are supported")
	}

	// Open the uploaded file
	file, err := fileHeader.Open()
	if err != nil {
		return nil, errors.Wrap(err, "failed to open uploaded file")
	}
	defer file.Close()

	// Create a new object record
	object := &models.Object{
		ID:               uuid.New(),
		OriginalFilename: fileHeader.Filename,
		ContentType:      "model/gltf-binary",
		Size:             fileHeader.Size,
		StorageKey:       uuid.New().String() + ".glb",
		UploadedAt:       time.Now(),
		Latitude:         latitude,
		Longitude:        longitude,
		Altitude:         altitude,
	}

	// Prepare metadata for MinIO
	metadata := map[string]string{
		"Filename":  object.OriginalFilename,
		"Object-ID": object.ID.String(),
	}

	if latitude != nil {
		metadata["Latitude"] = fmt.Sprintf("%f", *latitude)
	}
	if longitude != nil {
		metadata["Longitude"] = fmt.Sprintf("%f", *longitude)
	}
	if altitude != nil {
		metadata["Altitude"] = fmt.Sprintf("%f", *altitude)
	}

	_, err = s.Minio.PutObject(context.Background(), s.BucketName, object.StorageKey, file, fileHeader.Size, minio.PutObjectOptions{
		ContentType:  object.ContentType,
		UserMetadata: metadata,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to upload file to storage")
	}

	// Save object metadata to database
	err = s.Repo.CreateObject(object)
	if err != nil {
		return nil, errors.Wrap(err, "failed to save object metadata")
	}

	return object, nil
}

// GetObject retrieves an object's metadata by ID.
func (s *ObjectService) GetObject(id uuid.UUID) (*models.Object, error) {
	return s.Repo.GetObject(id)
}

// GetPredictedModels returns a list of object IDs that are predicted to be visible based on the given prediction request.
func (s *ObjectService) GetPredictedModels(req models.PredictionRequest) ([]uuid.UUID, error) {
	radiusMeter := s.Config.PredictionRadius

	objects, err := s.Repo.GetObjectsByLocation(
		req.Position.Latitude,
		req.Position.Longitude,
		radiusMeter,
	)
	log.Printf("Found %d objects", len(objects))
	if err != nil {
		return nil, err
	}

	var filteredObjects []models.Object

	// Apply distance filtering with exact calculation
	for _, obj := range objects {
		if obj.Latitude == nil || obj.Longitude == nil {
			continue // Skip objects without location data
		}

		distance := utils.HaversineDistance(
			req.Position.Latitude, req.Position.Longitude,
			*obj.Latitude, *obj.Longitude,
		)

		if distance <= s.Config.PredictionRadius {
			filteredObjects = append(filteredObjects, obj)
		}
	}

	var objectIDs []uuid.UUID
	for _, obj := range filteredObjects {
		objectIDs = append(objectIDs, obj.ID)
	}

	return objectIDs, nil
}

// ListObjects returns all stored object metadata.
func (s *ObjectService) ListObjects() ([]models.Object, error) {
	return s.Repo.ListObjects()
}

// DeleteObject removes an object and its file from storage.
func (s *ObjectService) DeleteObject(id uuid.UUID) error {
	obj, err := s.Repo.GetObject(id)
	if err != nil {
		return err
	}
	_ = s.Minio.RemoveObject(context.Background(), s.BucketName, obj.StorageKey, minio.RemoveObjectOptions{})
	return s.Repo.DeleteObject(id)
}
