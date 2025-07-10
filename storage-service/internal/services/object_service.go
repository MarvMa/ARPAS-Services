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

	"storage-service/internal/conversion"
	"storage-service/internal/extraction"
	"storage-service/internal/models"
	"storage-service/internal/repository"
)

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

// isAllowedExtension checks if a file extension is supported for 3D models.
func isAllowedExtension(ext string) bool {
	allowed := map[string]bool{
		".fbx": true, ".obj": true, ".dae": true, ".stl": true, ".gltf": true, ".glb": true,
	}
	return allowed[ext]
}

// isPrimaryModelFile checks if a file is a primary 3D model file (not a resource file)
func isPrimaryModelFile(ext string) bool {
	// Diese Extensions sind primäre Model-Dateien
	primary := map[string]bool{
		".fbx": true, ".obj": true, ".dae": true, ".stl": true, ".gltf": true, ".glb": true,
	}
	return primary[ext]
}

// isResourceFile checks if a file is a resource file (textures, materials, etc.)
func isResourceFile(ext string) bool {
	// Diese Extensions sind Ressourcen-Dateien
	resources := map[string]bool{
		".bin": true, ".mtl": true, ".jpg": true, ".jpeg": true, ".png": true,
		".tga": true, ".bmp": true, ".tiff": true, ".exr": true, ".hdr": true,
		".dds": true, ".ktx": true, ".basis": true,
	}
	return resources[ext]
}

// shouldIgnoreFile checks if a file should be ignored (system files, hidden files, etc.)
func shouldIgnoreFile(filename string) bool {
	// Ignoriere macOS Resource Fork Dateien
	if strings.HasPrefix(filename, "._") {
		return true
	}
	// Ignoriere versteckte Dateien
	if strings.HasPrefix(filename, ".") {
		return true
	}
	// Ignoriere macOS .DS_Store Dateien
	if filename == ".DS_Store" {
		return true
	}
	// Ignoriere Windows Thumbs.db
	if strings.ToLower(filename) == "thumbs.db" {
		return true
	}
	// Ignoriere leere Ordner-Marker
	if filename == "" || strings.HasSuffix(filename, "/") {
		return true
	}
	return false
}

// isArchiveFile checks if a file is an archive that should be extracted
func isArchiveFile(ext string) bool {
	archives := map[string]bool{
		".zip": true, ".rar": true, ".7z": true, ".tar": true, ".gz": true,
	}
	return archives[ext]
}

// CreateObject processes a single file upload, converts it to GLB if necessary, and stores it in MinIO.
func (s *ObjectService) CreateObject(fileHeader *multipart.FileHeader) (*models.Object, error) {
	origExt := filepath.Ext(fileHeader.Filename)
	if !isAllowedExtension(origExt) {
		return nil, fmt.Errorf("unsupported file format: %s", origExt)
	}

	srcFile, err := fileHeader.Open()
	if err != nil {
		return nil, errors.Wrap(err, "could not open uploaded file")
	}
	defer srcFile.Close()

	// Save the uploaded file to a temporary location
	tempDir := os.TempDir()
	tempInputFile, err := os.CreateTemp(tempDir, "upload-*"+origExt)
	if err != nil {
		return nil, errors.Wrap(err, "could not create temporary file")
	}
	tempInputPath := tempInputFile.Name()
	_, err = io.Copy(tempInputFile, srcFile)
	tempInputFile.Close()
	if err != nil {
		os.Remove(tempInputPath)
		return nil, errors.Wrap(err, "failed to write uploaded file")
	}

	// Convert to GLB if needed
	var glbPath string
	if origExt != ".glb" {
		glbPath, err = conversion.ConvertToGLB(tempInputPath)
		// Remove the original temp file after conversion
		os.Remove(tempInputPath)
		if err != nil {
			return nil, errors.Wrap(err, "conversion to glb failed")
		}
	} else {
		glbPath = tempInputPath
	}

	// Prepare to upload the GLB to object storage
	objectID := uuid.New()
	objectKey := objectID.String() + ".glb"
	glbFile, err := os.Open(glbPath)
	if err != nil {
		os.Remove(glbPath)
		return nil, errors.Wrap(err, "could not open converted glb file")
	}
	stat, err := glbFile.Stat()
	if err != nil {
		glbFile.Close()
		os.Remove(glbPath)
		return nil, errors.Wrap(err, "could not stat glb file")
	}

	_, err = s.Minio.PutObject(
		context.Background(),
		s.BucketName,
		objectKey,
		glbFile,
		stat.Size(),
		minio.PutObjectOptions{ContentType: "model/gltf-binary"},
	)
	glbFile.Close()
	if err != nil {
		os.Remove(glbPath)
		return nil, errors.Wrap(err, "failed to upload to MinIO")
	}

	// Cleanup temp GLB file after upload
	os.Remove(glbPath)

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

// CreateObjectFromFiles processes multiple files (one model file + its resource files).
func (s *ObjectService) CreateObjectFromFiles(fileHeaders []*multipart.FileHeader) (*models.Object, error) {
	tempDir := os.TempDir()
	var mainFilePath, mainFilename, mainExt string
	var tempFiles []string
	var modelFileCount int

	for _, fh := range fileHeaders {
		ext := filepath.Ext(fh.Filename)

		src, err := fh.Open()
		if err != nil {
			return nil, errors.Wrap(err, "could not open uploaded file")
		}
		// Save each uploaded file to temp
		tempFile, err := os.CreateTemp(tempDir, "upload-*"+ext)
		if err != nil {
			src.Close()
			return nil, errors.Wrap(err, "could not create temporary file")
		}
		tmpPath := tempFile.Name()
		tempFiles = append(tempFiles, tmpPath)

		_, err = io.Copy(tempFile, src)
		tempFile.Close()
		src.Close()
		if err != nil {
			// Clean up any temp files on error
			for _, p := range tempFiles {
				os.Remove(p)
			}
			return nil, errors.Wrap(err, "failed to write uploaded files")
		}

		// Identify the main model file among the uploads
		if isPrimaryModelFile(ext) {
			modelFileCount++
			if modelFileCount > 1 {
				// More than one model file found
				for _, p := range tempFiles {
					os.Remove(p)
				}
				return nil, fmt.Errorf("multiple model files provided")
			}
			mainFilePath = tmpPath
			mainFilename = fh.Filename
			mainExt = ext
		}
		// Resource files (textures, .bin, .mtl, etc.) are saved to tempFiles but not treated as model files
	}

	if mainFilePath == "" {
		// No primary model file was found in the upload
		for _, p := range tempFiles {
			os.Remove(p)
		}
		return nil, fmt.Errorf("no primary 3d model file found")
	}

	var glbPath string
	var err error
	if mainExt != ".glb" {
		// Convert the main model file to GLB
		glbPath, err = conversion.ConvertToGLB(mainFilePath)
		// Remove all temporary files after conversion (they are no longer needed)
		for _, p := range tempFiles {
			os.Remove(p)
		}
		if err != nil {
			return nil, errors.Wrap(err, "conversion to glb failed")
		}
	} else {
		glbPath = mainFilePath
		// Remove all other temp files except the main GLB
		for _, p := range tempFiles {
			if p != mainFilePath {
				os.Remove(p)
			}
		}
	}

	// Upload the GLB file to storage and save metadata
	objectID := uuid.New()
	objectKey := objectID.String() + ".glb"
	glbFile, err := os.Open(glbPath)
	if err != nil {
		os.Remove(glbPath)
		return nil, errors.Wrap(err, "could not open converted glb file")
	}
	stat, err := glbFile.Stat()
	if err != nil {
		glbFile.Close()
		os.Remove(glbPath)
		return nil, errors.Wrap(err, "could not stat glb file")
	}

	_, err = s.Minio.PutObject(
		context.Background(),
		s.BucketName,
		objectKey,
		glbFile,
		stat.Size(),
		minio.PutObjectOptions{ContentType: "model/gltf-binary"},
	)
	glbFile.Close()
	if err != nil {
		os.Remove(glbPath)
		return nil, errors.Wrap(err, "failed to upload to MinIO")
	}
	os.Remove(glbPath)

	obj := &models.Object{
		ID:               objectID,
		OriginalFilename: mainFilename,
		ContentType:      "model/gltf-binary",
		Size:             stat.Size(),
		StorageKey:       objectKey,
		UploadedAt:       time.Now(),
	}
	if err := s.Repo.CreateObject(obj); err != nil {
		s.Minio.RemoveObject(context.Background(), s.BucketName, objectKey, minio.RemoveObjectOptions{})
		return nil, errors.Wrap(err, "failed to save metadata to database")
	}

	return obj, nil
}

// CreateObjectFromArchive processes an uploaded archive file (ZIP or RAR).
// It extracts the archive, converts the contained model to GLB, and stores the result.
func (s *ObjectService) CreateObjectFromArchive(fileHeader *multipart.FileHeader) (*models.Object, error) {
	ext := filepath.Ext(fileHeader.Filename)
	if ext != ".zip" && ext != ".rar" {
		return nil, fmt.Errorf("unsupported archive format: %s", ext)
	}
	srcFile, err := fileHeader.Open()
	if err != nil {
		return nil, errors.Wrap(err, "could not open uploaded archive")
	}
	defer srcFile.Close()

	tempDir := os.TempDir()
	tempArchive, err := os.CreateTemp(tempDir, "upload-*"+ext)
	if err != nil {
		return nil, errors.Wrap(err, "could not create temporary file for archive")
	}
	tempArchivePath := tempArchive.Name()
	_, err = io.Copy(tempArchive, srcFile)
	tempArchive.Close()
	if err != nil {
		os.Remove(tempArchivePath)
		return nil, errors.Wrap(err, "failed to write uploaded archive")
	}

	// Extract the archive to a temporary directory
	files, destDir, err := extraction.ExtractArchive(tempArchivePath)
	// Remove the temp archive file after extraction
	os.Remove(tempArchivePath)
	if err != nil {
		return nil, errors.Wrap(err, "failed to extract archive")
	}
	// Ensure the extraction directory is cleaned up at the end
	defer os.RemoveAll(destDir)

	// Identify the main model file in the extracted files
	var mainFilePath, mainFilename, mainExt string
	var modelFileCount int
	var foundFiles []string
	var resourceFiles []string
	var nestedArchives []string

	for _, path := range files {
		filename := filepath.Base(path)

		// Ignoriere System-Dateien und macOS Resource Forks
		if shouldIgnoreFile(filename) {
			continue
		}

		e := filepath.Ext(strings.ToLower(path))

		if isPrimaryModelFile(e) {
			modelFileCount++
			foundFiles = append(foundFiles, fmt.Sprintf("MODEL: %s (%s)", filename, e))
			if modelFileCount > 1 {
				return nil, fmt.Errorf("multiple model files found in archive: %v", foundFiles)
			}
			mainFilePath = path
			mainFilename = filename
			mainExt = e
		} else if isResourceFile(e) {
			resourceFiles = append(resourceFiles, fmt.Sprintf("RESOURCE: %s (%s)", filename, e))
		} else if isArchiveFile(e) {
			nestedArchives = append(nestedArchives, path)
			foundFiles = append(foundFiles, fmt.Sprintf("NESTED_ARCHIVE: %s (%s)", filename, e))
		} else {
			foundFiles = append(foundFiles, fmt.Sprintf("UNKNOWN: %s (%s)", filename, e))
		}
	}

	// Wenn keine Model-Datei gefunden wurde, aber verschachtelte Archive existieren,
	// extrahiere das erste Archive
	if mainFilePath == "" && len(nestedArchives) > 0 {
		nestedArchivePath := nestedArchives[0]
		nestedFilename := filepath.Base(nestedArchivePath)

		// Extrahiere das verschachtelte Archiv
		nestedFiles, nestedDestDir, err := extraction.ExtractArchive(nestedArchivePath)
		if err != nil {
			allFiles := append(foundFiles, resourceFiles...)
			return nil, fmt.Errorf("failed to extract nested archive %s: %v. Found files: %v", nestedFilename, err, allFiles)
		}
		defer os.RemoveAll(nestedDestDir)

		// Suche nach Model-Dateien im verschachtelten Archiv
		var nestedModelCount int
		for _, nestedPath := range nestedFiles {
			nestedFilename := filepath.Base(nestedPath)
			if shouldIgnoreFile(nestedFilename) {
				continue
			}

			nestedExt := filepath.Ext(strings.ToLower(nestedPath))
			if isPrimaryModelFile(nestedExt) {
				nestedModelCount++
				if nestedModelCount > 1 {
					return nil, fmt.Errorf("multiple model files found in nested archive %s", nestedFilename)
				}
				mainFilePath = nestedPath
				mainFilename = nestedFilename
				mainExt = nestedExt
			}
		}
	}

	if mainFilePath == "" {
		allFiles := append(foundFiles, resourceFiles...)
		return nil, fmt.Errorf("no 3d model file found in archive. Found files: %v", allFiles)
	}

	// Convert the model to GLB if necessary
	var glbPath string
	if mainExt != ".glb" {
		glbPath, err = conversion.ConvertToGLB(mainFilePath)
		if err != nil {
			return nil, errors.Wrap(err, "conversion to glb failed")
		}
	} else {
		glbPath = mainFilePath
	}

	// Upload GLB to MinIO
	objectID := uuid.New()
	objectKey := objectID.String() + ".glb"
	glbFile, err := os.Open(glbPath)
	if err != nil {
		return nil, errors.Wrap(err, "could not open glb file")
	}
	stat, err := glbFile.Stat()
	if err != nil {
		glbFile.Close()
		return nil, errors.Wrap(err, "could not stat glb file")
	}
	_, err = s.Minio.PutObject(
		context.Background(),
		s.BucketName,
		objectKey,
		glbFile,
		stat.Size(),
		minio.PutObjectOptions{ContentType: "model/gltf-binary"},
	)
	glbFile.Close()
	if err != nil {
		return nil, errors.Wrap(err, "failed to upload to MinIO")
	}

	// Create metadata entry in the database
	obj := &models.Object{
		ID:               objectID,
		OriginalFilename: mainFilename,
		ContentType:      "model/gltf-binary",
		Size:             stat.Size(),
		StorageKey:       objectKey,
		UploadedAt:       time.Now(),
	}
	if err := s.Repo.CreateObject(obj); err != nil {
		// Remove the file from storage if DB save fails
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
func (s *ObjectService) GetPredictedModels(req models.PredictionRequest) ([]int, error) {
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
