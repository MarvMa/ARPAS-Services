package utils

import (
	"bufio"
	"sync/atomic"
	"time"
)

type ThroughputWriter struct {
	W           *bufio.Writer
	firstByteNs int64
	bytes       int64
}

func NewThroughputWriter(w *bufio.Writer) *ThroughputWriter { return &ThroughputWriter{W: w} }

func (t *ThroughputWriter) Write(p []byte) (int, error) {
	// first byte timestamp
	if atomic.LoadInt64(&t.firstByteNs) == 0 {
		now := time.Now().UnixNano()
		atomic.CompareAndSwapInt64(&t.firstByteNs, 0, now)
	}
	n, err := t.W.Write(p)
	atomic.AddInt64(&t.bytes, int64(n))
	return n, err
}

func (t *ThroughputWriter) FirstByteAt() time.Time {
	ns := atomic.LoadInt64(&t.firstByteNs)
	if ns == 0 {
		return time.Time{}
	}
	return time.Unix(0, ns)
}
func (t *ThroughputWriter) Bytes() int64 { return atomic.LoadInt64(&t.bytes) }
