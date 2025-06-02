package services

import (
	"context"
	"github.com/minio/minio-go/v7"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"storage-service/internal/conversion"
	"storage-service/internal/models"
	"storage-service/internal/repository"
)

// ObjectService orchestrates operations on 3D objects, including conversion, storage, and metadata.
type ObjectService struct {
	Repo       *repository.ObjectRepository
	Minio      *minio.Client
	BucketName string
}

// NewObjectService creates a new ObjectService with the given repository and storage client.
func NewObjectService(repo *repository.ObjectRepository, minioClient *minio.Client, bucketName string) *ObjectService {
	return &ObjectService{
		Repo:       repo,
		Minio:      minioClient,
		BucketName: bucketName,
	}
}

// CreateObject handles a new 3D object upload: converts it to .glb, stores it, and saves metadata.
func (s *ObjectService) CreateObject(fileHeader *multipart.FileHeader) (*models.Object, error) {
	// Read the uploaded file into a temporary file
	srcFile, err := fileHeader.Open()
	if err != nil {
		return nil, err
	}
	defer srcFile.Close()

	// Create a temporary file to save the upload
	tempDir := os.TempDir()
	origExt := filepath.Ext(fileHeader.Filename)
	origFilename := fileHeader.Filename
	outFile, err := os.CreateTemp(tempDir, "upload-*"+origExt)
	if err != nil {
		return nil, err
	}
	tempFilePath := outFile.Name()
	_, err = io.Copy(outFile, srcFile)
	outFile.Close()
	if err != nil {
		return nil, err
	}

	// Convert to GLB format if not already .glb
	var glbPath string
	if filepath.Ext(origFilename) != ".glb" {
		glbPath, err = conversion.ConvertToGLB(tempFilePath)
		if err != nil {
			os.Remove(tempFilePath)
			return nil, err
		}
		// Remove the original temp file after conversion
		os.Remove(tempFilePath)
	} else {
		// If already .glb, use the original file
		glbPath = tempFilePath
	}

	// Upload the GLB to MinIO
	objectID := uuid.New()
	objectKey := objectID.String() + ".glb"
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
		// Clean up glb file
		os.Remove(glbPath)
		return nil, err
	}
	// Remove the glb file from local disk after upload
	os.Remove(glbPath)

	// Prepare metadata and save to database
	object := &models.Object{
		ID:               objectID,
		OriginalFilename: origFilename,
		ContentType:      "model/gltf-binary",
		Size:             stat.Size(),
		UploadedAt:       time.Now(),
		StorageKey:       objectKey,
	}
	err = s.Repo.Create(object)
	if err != nil {
		// If DB save fails, remove the stored object to avoid orphaned file
		s.Minio.RemoveObject(context.Background(), s.BucketName, objectKey, minio.RemoveObjectOptions{})
		return nil, err
	}
	return object, nil
}

// GetObject retrieves an object's metadata by ID.
func (s *ObjectService) GetObject(id uuid.UUID) (*models.Object, error) {
	return s.Repo.GetByID(id)
}

// ListObjects returns all stored object metadata.
func (s *ObjectService) ListObjects() ([]models.Object, error) {
	return s.Repo.List()
}

// UpdateObject replaces an existing object's file (and updates metadata).
func (s *ObjectService) UpdateObject(id uuid.UUID, fileHeader *multipart.FileHeader) (*models.Object, error) {
	obj, err := s.Repo.GetByID(id)
	if err != nil {
		return nil, err
	}
	s.Minio.RemoveObject(context.Background(), s.BucketName, obj.StorageKey, minio.RemoveObjectOptions{})

	obj.OriginalFilename = fileHeader.Filename

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
		glbPath, err = conversion.ConvertToGLB(tempFilePath)
		if err != nil {
			os.Remove(tempFilePath)
			return nil, err
		}
		os.Remove(tempFilePath)
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
	// Update metadata
	obj.ContentType = "model/gltf-binary"
	obj.Size = stat.Size()
	obj.UploadedAt = time.Now()
	obj.StorageKey = objectKey
	err = s.Repo.Update(obj)
	if err != nil {
		// If DB update fails, remove the new file to avoid inconsistency
		s.Minio.RemoveObject(context.Background(), s.BucketName, objectKey, minio.RemoveObjectOptions{})
		return nil, err
	}
	return obj, nil
}

// DeleteObject removes an object and its file from storage.
func (s *ObjectService) DeleteObject(id uuid.UUID) error {
	obj, err := s.Repo.GetByID(id)
	if err != nil {
		return err
	}
	// Remove from storage
	_ = s.Minio.RemoveObject(context.Background(), s.BucketName, obj.StorageKey, minio.RemoveObjectOptions{})
	// Remove from database
	return s.Repo.Delete(id)
}
