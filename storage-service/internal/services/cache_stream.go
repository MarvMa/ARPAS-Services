package services

import (
	"io"
	"storage-service/internal/storage"
)

type redisChunkReader struct {
	cli      *storage.RedisClient
	key      string
	off      int64
	size     int64
	closed   bool
	maxChunk int64

	buf    []byte
	bufPos int
}

func newRedisChunkReader(cli *storage.RedisClient, key string, size int64, maxChunk int64) io.ReadCloser {
	if maxChunk <= 0 {
		maxChunk = 16 << 20 // 16 MiB
	}
	return &redisChunkReader{cli: cli, key: key, size: size, maxChunk: maxChunk}
}

func (r *redisChunkReader) Read(p []byte) (int, error) {
	if r.closed || r.off >= r.size {
		return 0, io.EOF
	}

	if r.bufPos < len(r.buf) {
		n := copy(p, r.buf[r.bufPos:])
		r.bufPos += n
		r.off += int64(n)
		if r.bufPos >= len(r.buf) {
			r.buf = nil
			r.bufPos = 0
		}
		return n, nil
	}

	remain := r.size - r.off
	req := r.maxChunk
	if remain < req {
		req = remain
	}
	end := r.off + req - 1

	data, err := r.cli.GetRange(r.key, r.off, end)
	if err != nil {
		return 0, err
	}
	if len(data) == 0 {
		return 0, io.EOF
	}

	r.buf = data
	r.bufPos = 0

	n := copy(p, r.buf)
	r.bufPos += n
	r.off += int64(n)
	if r.bufPos >= len(r.buf) {
		r.buf = nil
		r.bufPos = 0
	}
	return n, nil
}

func (r *redisChunkReader) Close() error {
	r.closed = true
	r.buf = nil
	return nil
}
