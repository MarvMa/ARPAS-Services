package services

import (
	"io"
	"time"
)

type countingReadCloser struct {
	rc          io.ReadCloser
	bytes       int64
	lastReadMs  int64
	sumReadMs   int64
	firstReadAt time.Time
}

func NewCountingRC(rc io.ReadCloser) *countingReadCloser { return &countingReadCloser{rc: rc} }

func (c *countingReadCloser) Read(p []byte) (int, error) {
	t0 := time.Now()
	n, err := c.rc.Read(p)
	lat := time.Since(t0).Milliseconds()
	c.lastReadMs = lat
	c.sumReadMs += lat
	if n > 0 && c.firstReadAt.IsZero() {
		c.firstReadAt = time.Now()
	}
	c.bytes += int64(n)
	return n, err
}
func (c *countingReadCloser) Close() error { return c.rc.Close() }

func (c *countingReadCloser) Stats() (bytes int64, lastReadMs, totalReadMs int64) {
	return c.bytes, c.lastReadMs, c.sumReadMs
}
