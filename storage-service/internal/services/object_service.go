package services

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/pkg/errors"
	"mime/multipart"

	"storage-service/internal/models"
	"storage-service/internal/repository"
)

// ObjectService provides methods for managing 3D objects in storage.
type ObjectService struct {
	Repo          *repository.ObjectRepositoryImpl
	ObjectRefRepo *repository.ObjectRefRepositoryImpl // Assuming this is defined in your repository packagepackage
	Minio         *minio.Client
	BucketName    string
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
func (s *ObjectService) CreateObject(fileHeader *multipart.FileHeader) (*models.Object, error) {
	origExt := filepath.Ext(fileHeader.Filename)
	if origExt != ".glb" {
		return nil, fmt.Errorf("only GLB files are supported, got: %s", origExt)
	}

	srcFile, err := fileHeader.Open()
	if err != nil {
		return nil, errors.Wrap(err, "could not open uploaded file")
	}
	defer srcFile.Close()

	// Save the uploaded file to a temporary location
	tempDir := os.TempDir()
	tempInputFile, err := os.CreateTemp(tempDir, "upload-*.glb")
	if err != nil {
		return nil, errors.Wrap(err, "could not create temporary file")
	}
	tempInputPath := tempInputFile.Name()
	defer os.Remove(tempInputPath) // Clean up temp file

	_, err = io.Copy(tempInputFile, srcFile)
	tempInputFile.Close()
	if err != nil {
		return nil, errors.Wrap(err, "failed to write uploaded file")
	}

	// Prepare to upload the GLB to object storage
	objectID := uuid.New()
	objectKey := objectID.String() + ".glb"

	glbFile, err := os.Open(tempInputPath)
	if err != nil {
		return nil, errors.Wrap(err, "could not open GLB file")
	}
	defer glbFile.Close()

	stat, err := glbFile.Stat()
	if err != nil {
		return nil, errors.Wrap(err, "could not stat GLB file")
	}

	_, err = s.Minio.PutObject(
		context.Background(),
		s.BucketName,
		objectKey,
		glbFile,
		stat.Size(),
		minio.PutObjectOptions{ContentType: "model/gltf-binary"},
	)
	if err != nil {
		return nil, errors.Wrap(err, "failed to upload to MinIO")
	}

	// Create metadata record
	obj := &models.Object{
		ID:               objectID,
		OriginalFilename: fileHeader.Filename,
		ContentType:      "model/gltf-binary",
		Size:             stat.Size(),
		StorageKey:       objectKey,
		UploadedAt:       time.Now(),
	}
	if err := s.Repo.CreateObject(obj); err != nil {
		// If DB save fails, remove the object from storage to avoid orphan file
		s.Minio.RemoveObject(context.Background(), s.BucketName, objectKey, minio.RemoveObjectOptions{})
		return nil, errors.Wrap(err, "failed to save metadata to database")
	}

	return obj, nil
}

// GetObject retrieves an object's metadata by ID.
func (s *ObjectService) GetObject(id uuid.UUID) (*models.Object, error) {
	return s.Repo.GetObject(id)
}

// GetPredictedModels returns a list of object IDs that are predicted to be visible based on the given prediction request.
func (s *ObjectService) GetPredictedModels(req models.PredictionRequest) ([]uuid.UUID, error) {
	// Use 30 meter radius as specified
	radiusMeters := 30.0

	objectRefs, err := s.ObjectRefRepo.FindObjectRefsWithinRadius(
		req.Position.Latitude,
		req.Position.Longitude,
		radiusMeters,
	)
	if err != nil {
		return nil, err
	}

	var objectIDs []uuid.UUID
	for _, objRef := range objectRefs {
		objectIDs = append(objectIDs, objRef.ObjectID)
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
