package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"storage-service/internal/metrics"
	"storage-service/internal/models"
	"storage-service/internal/services"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"gorm.io/gorm"
)

// InstrumentedObjectHandler extends ObjectHandler with detailed metrics
type InstrumentedObjectHandler struct {
	*ObjectHandler
	InstrumentedCache *services.InstrumentedCacheService
}

// NewInstrumentedObjectHandler creates a new instrumented handler
func NewInstrumentedObjectHandler(service *services.ObjectService, instrumentedCache *services.InstrumentedCacheService) *InstrumentedObjectHandler {
	return &InstrumentedObjectHandler{
		ObjectHandler: &ObjectHandler{
			Service:      service,
			CacheService: instrumentedCache.CacheService,
		},
		InstrumentedCache: instrumentedCache,
	}
}

// DownloadObject handles GET /objects/:id/download
func (h *InstrumentedObjectHandler) DownloadObject(c *fiber.Ctx) error {
	idStr := c.Params("id")
	optimizationMode := strings.ToLower(c.Get("X-Optimization-Mode"))

	// Initialize metrics collector
	metrics := metrics.NewLatencyMetrics(idStr)
	metrics.SetOptimizationMode(optimizationMode)

	log.Printf("Downloading object - ID: %s, Mode: %s, Method: %s, Path: %s, IP: %s",
		idStr, optimizationMode, c.Method(), c.Path(), c.IP())

	// Parse UUID
	objectID, err := uuid.Parse(idStr)
	if err != nil {
		log.Printf("Invalid UUID format for download: %s - Error: %v", idStr, err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": true, "message": "invalid UUID",
		})
	}

	// Database lookup with metrics
	metrics.StartDBLookup()
	obj, err := h.Service.GetObject(objectID)
	metrics.EndDBLookup()

	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": true, "message": "object not found",
			})
		}
		log.Printf("DB error for %s: %v", objectID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": true, "message": "internal error",
		})
	}

	// Set object size in metrics
	metrics.SetObjectSize(obj.Size)

	// Route to appropriate handler based on optimization mode
	if optimizationMode == "optimized" {
		return h.handleOptimizedDownloadWithMetrics(c, obj, metrics)
	}

	return h.handleDirectMinIODownloadWithMetrics(c, obj, metrics)
}

// handleOptimizedDownloadWithMetrics handles optimized download with full metrics
func (h *InstrumentedObjectHandler) handleOptimizedDownloadWithMetrics(c *fiber.Ctx, obj *models.Object, metrics *metrics.LatencyMetrics) error {
	cacheStats, _ := h.InstrumentedCache.GetStatistics()

	rc, clen, err, layerUsed := h.InstrumentedCache.GetFromCacheStreamWithMetrics(c.Context(), obj.ID, metrics)

	if err == nil && rc != nil {
		defer rc.Close()

		metrics.RecordFirstByte()

		h.setOptimizedResponseHeaders(c, obj, clen, metrics, cacheStats)

		metrics.StartStream()
		err = h.streamContent(c, rc, clen)
		metrics.EndStream()

		metrics.Finalize()

		log.Printf("OPTIMIZED download complete - Object: %s, Layer: %s, Total: %.2fms, FirstByte: %.2fms",
			obj.ID, layerUsed, metrics.TotalLatencyMs, metrics.FirstByteLatencyMs)

		return err
	}

	// Cache miss - fallback to MinIO
	log.Printf("Optimized cache miss for %s: %v, falling back to MinIO", obj.ID, err)
	return h.handleDirectMinIODownloadWithMetrics(c, obj, metrics)
}

// handleDirectMinIODownloadWithMetrics handles direct MinIO download with metrics
func (h *InstrumentedObjectHandler) handleDirectMinIODownloadWithMetrics(c *fiber.Ctx, obj *models.Object, metrics *metrics.LatencyMetrics) error {
	// Start MinIO timing
	log.Printf("Direct MinIO download for object %s (key: %s)", obj.ID, obj.StorageKey)
	metrics.StartMinIO()

	// Get object size
	var clen int64 = -1
	if stat, statErr := h.Service.Minio.StatObject(c.Context(), h.Service.BucketName, obj.StorageKey, minio.StatObjectOptions{}); statErr == nil {
		clen = stat.Size
	}

	// Get object from MinIO
	object, err := h.Service.Minio.GetObject(c.Context(), h.Service.BucketName, obj.StorageKey, minio.GetObjectOptions{})
	metrics.EndMinIO()

	if err != nil {
		log.Printf("Failed to retrieve file from MinIO: key=%s err=%v", obj.StorageKey, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": true, "message": "unable to retrieve file",
		})
	}
	defer object.Close()

	// Record first byte
	metrics.RecordFirstByte()

	// Set response headers with metrics
	h.setMinIOResponseHeaders(c, obj, clen, metrics)

	// Stream content with metrics
	metrics.StartStream()
	err = h.streamContent(c, object, clen)
	metrics.EndStream()

	// Finalize metrics
	metrics.Finalize()

	// Log performance
	log.Printf("DIRECT MinIO download complete - Object: %s, Total: %.2fms, FirstByte: %.2fms, MinIO: %.2fms",
		obj.ID, metrics.TotalLatencyMs, metrics.FirstByteLatencyMs, metrics.MinIOLatencyMs)

	return err
}

// setOptimizedResponseHeaders sets comprehensive headers for optimized downloads
func (h *InstrumentedObjectHandler) setOptimizedResponseHeaders(c *fiber.Ctx, obj *models.Object, clen int64, metrics *metrics.LatencyMetrics, cacheStats *services.OptimizedCacheStatistics) {
	ct := obj.ContentType
	if ct == "" {
		ct = "model/gltf-binary"
	}

	// Standard content headers
	c.Set(fiber.HeaderContentType, ct)
	c.Set(fiber.HeaderContentDisposition, fmt.Sprintf("attachment; filename=\"%s.glb\"", obj.ID))
	c.Set("Content-Encoding", "identity")

	// Apply all metric headers
	for key, value := range metrics.GetHeaders() {
		c.Set(key, value)
	}

	// Additional cache statistics if available
	if cacheStats != nil {
		if statsJson, err := json.Marshal(cacheStats.MultiLayer); err == nil {
			c.Set("X-Cache-Stats", string(statsJson))
		}
	}

	// Content length
	if clen > 0 {
		c.Set(fiber.HeaderContentLength, fmt.Sprintf("%d", clen))
	}

	// Cache control
	c.Set("Cache-Control", "public, max-age=3600")
	c.Set("ETag", fmt.Sprintf("\"%s\"", obj.ID))
}

// setMinIOResponseHeaders sets comprehensive headers for MinIO downloads
func (h *InstrumentedObjectHandler) setMinIOResponseHeaders(c *fiber.Ctx, obj *models.Object, clen int64, metrics *metrics.LatencyMetrics) {
	ct := obj.ContentType
	if ct == "" {
		ct = "model/gltf-binary"
	}

	// Standard content headers
	c.Set(fiber.HeaderContentType, ct)
	c.Set(fiber.HeaderContentDisposition, fmt.Sprintf("attachment; filename=\"%s.glb\"", obj.ID))
	c.Set("Content-Encoding", "identity")

	// Apply all metric headers
	for key, value := range metrics.GetHeaders() {
		c.Set(key, value)
	}

	// Content length
	if clen > 0 {
		c.Set(fiber.HeaderContentLength, fmt.Sprintf("%d", clen))
	}
}

// streamContent streams content to the client
func (h *InstrumentedObjectHandler) streamContent(c *fiber.Ctx, reader io.Reader, size int64) error {
	// Create a wrapped reader that closes if it's a ReadCloser
	var bodyReader io.Reader = reader
	if rc, ok := reader.(io.ReadCloser); ok {
		bodyReader = &autoCloseReader{ReadCloser: rc}
	}

	// Set the body stream
	c.Context().SetBodyStream(bodyReader, int(size))

	return c.SendStatus(fiber.StatusOK)
}

// autoCloseReader automatically closes the reader on EOF
type autoCloseReader struct {
	io.ReadCloser
}

func (r *autoCloseReader) Read(p []byte) (int, error) {
	n, err := r.ReadCloser.Read(p)
	if err == io.EOF {
		_ = r.ReadCloser.Close()
	}
	return n, err
}

// InstrumentedStreamWriter tracks streaming performance
type InstrumentedStreamWriter struct {
	w             io.Writer
	bytesWritten  int64
	firstByteTime *time.Time
	metrics       *metrics.LatencyMetrics
}

func NewInstrumentedStreamWriter(w io.Writer, metrics *metrics.LatencyMetrics) *InstrumentedStreamWriter {
	return &InstrumentedStreamWriter{
		w:       w,
		metrics: metrics,
	}
}

func (isw *InstrumentedStreamWriter) Write(p []byte) (int, error) {
	// Record first byte
	if isw.firstByteTime == nil {
		now := time.Now()
		isw.firstByteTime = &now
		isw.metrics.RecordFirstByte()
	}

	n, err := isw.w.Write(p)
	isw.bytesWritten += int64(n)
	return n, err
}
