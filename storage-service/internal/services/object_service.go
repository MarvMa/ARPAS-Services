package services

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/pkg/errors"
	"mime/multipart"

	"storage-service/internal/models"
	"storage-service/internal/repository"
)

const DEFAULT_RADIUS = 30.0

// ObjectService provides methods for managing 3D objects in storage.
type ObjectService struct {
	Repo       *repository.ObjectRepositoryImpl
	Minio      *minio.Client
	BucketName string
}

// NewObjectService creates a new ObjectService with the given repository and storage client.
func NewObjectService(repo *repository.ObjectRepositoryImpl, minioClient *minio.Client, bucketName string) *ObjectService {
	return &ObjectService{
		Repo:       repo,
		Minio:      minioClient,
		BucketName: bucketName,
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
	objects, err := s.Repo.GetObjectsByLocation(
		req.Position.Latitude,
		req.Position.Longitude,
		DEFAULT_RADIUS,
	)
	if err != nil {
		return nil, err
	}

	var objectIDs []uuid.UUID
	for _, obj := range objects {
		objectIDs = append(objectIDs, obj.ID)
	}

	return objectIDs, nil
}

// ListObjects returns all stored object metadata.
func (s *ObjectService) ListObjects() ([]models.Object, error) {
	return s.Repo.ListObjects()
}

// UpdateObject replaces an existing object's file (and updates metadata).
func (s *ObjectService) UpdateObject(id uuid.UUID, fileHeader *multipart.FileHeader) (*models.Object, error) {
	obj, err := s.Repo.GetObject(id)
	if err != nil {
		return nil, err
	}
	// Remove the old file from storage
	s.Minio.RemoveObject(context.Background(), s.BucketName, obj.StorageKey, minio.RemoveObjectOptions{})

	obj.OriginalFilename = fileHeader.Filename

	// Save the new file to temp
	srcFile, err := fileHeader.Open()
	if err != nil {
		return nil, err
	}
	defer srcFile.Close()
	tempDir := os.TempDir()
	newExt := filepath.Ext(fileHeader.Filename)
	outFile, err := os.CreateTemp(tempDir, "upload-*"+newExt)
	if err != nil {
		return nil, err
	}
	tempFilePath := outFile.Name()
	_, err = io.Copy(outFile, srcFile)
	outFile.Close()
	if err != nil {
		return nil, err
	}
	var glbPath string
	if filepath.Ext(fileHeader.Filename) != ".glb" {
		return nil, fmt.Errorf("only GLB files are supported, got: %s", fileHeader.Filename)
	} else {
		glbPath = tempFilePath
	}
	objectKey := obj.ID.String() + ".glb"
	glbFile, err := os.Open(glbPath)
	if err != nil {
		return nil, err
	}
	defer glbFile.Close()
	stat, _ := glbFile.Stat()
	_, err = s.Minio.PutObject(context.Background(), s.BucketName, objectKey, glbFile, stat.Size(), minio.PutObjectOptions{
		ContentType: "model/gltf-binary",
	})
	if err != nil {
		os.Remove(glbPath)
		return nil, err
	}
	os.Remove(glbPath)
	obj.ContentType = "model/gltf-binary"
	obj.Size = stat.Size()
	obj.UploadedAt = time.Now()
	obj.StorageKey = objectKey
	err = s.Repo.UpdateObject(obj)
	if err != nil {
		s.Minio.RemoveObject(context.Background(), s.BucketName, objectKey, minio.RemoveObjectOptions{})
		return nil, err
	}
	return obj, nil
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
