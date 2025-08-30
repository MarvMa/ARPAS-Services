package utils

import "sync"

type BufferPool struct {
	pools      []*sync.Pool
	numBuckets int
}

func NewBufferPool() *BufferPool {
	numBuckets := 20
	bp := &BufferPool{
		pools:      make([]*sync.Pool, numBuckets),
		numBuckets: numBuckets,
	}

	for i := range bp.pools {
		poolSize := 1 << (i + 12) // Bucket sizes: 4KB, 8KB, ..., ~1GB
		bp.pools[i] = &sync.Pool{
			New: func(size int) func() interface{} {
				return func() interface{} {
					return make([]byte, size)
				}
			}(poolSize),
		}
	}
	return bp
}

func (bp *BufferPool) Get(size int) []byte {
	if size <= 0 {
		return nil
	}
	if size > (1 << (bp.numBuckets + 11)) { // Larger than the largest bucket (~1GB)
		return make([]byte, size)
	}

	poolIndex := bp.getPoolIndex(size)
	if poolIndex >= 0 && poolIndex < len(bp.pools) {
		if buf := bp.pools[poolIndex].Get(); buf != nil {
			b := buf.([]byte)
			if cap(b) >= size {
				return b[:size]
			}
		}
	}
	return make([]byte, size)
}
func (bp *BufferPool) getPoolIndex(size int) int {
	for i := 0; i < bp.numBuckets; i++ {
		if 1<<(i+12) >= size {
			return i
		}
	}
	return -1
}

func (bp *BufferPool) Put(buf []byte) {
	if buf == nil {
		return
	}
	size := cap(buf)
	if size > (1 << (bp.numBuckets + 11)) {
		return
	}

	for i := 0; i < bp.numBuckets; i++ {
		poolSize := 1 << (i + 12)
		if poolSize == size {
			buf = buf[:0]
			bp.pools[i].Put(buf)
			return
		}
	}
}
