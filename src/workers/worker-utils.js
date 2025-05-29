/**
 * Shared utilities for Web Workers
 * Common functions and algorithms used across all worker types
 */

/**
 * Spatial grid utilities for particle management
 */
class SpatialGrid {
    constructor(bounds, cellSize) {
        this.bounds = bounds;
        this.cellSize = cellSize;
        this.gridDimensions = [
            Math.ceil((bounds.max[0] - bounds.min[0]) / cellSize),
            Math.ceil((bounds.max[1] - bounds.min[1]) / cellSize),
            Math.ceil((bounds.max[2] - bounds.min[2]) / cellSize)
        ];
        this.grid = new Map();
    }

    getCellIndex(x, y, z) {
        const cellX = Math.floor((x - this.bounds.min[0]) / this.cellSize);
        const cellY = Math.floor((y - this.bounds.min[1]) / this.cellSize);
        const cellZ = Math.floor((z - this.bounds.min[2]) / this.cellSize);
        
        return `${cellX},${cellY},${cellZ}`;
    }

    addParticle(particleIndex, x, y, z) {
        const cellIndex = this.getCellIndex(x, y, z);
        if (!this.grid.has(cellIndex)) {
            this.grid.set(cellIndex, []);
        }
        this.grid.get(cellIndex).push(particleIndex);
    }

    getNeighbors(x, y, z, radius = 1) {
        const neighbors = [];
        const cellX = Math.floor((x - this.bounds.min[0]) / this.cellSize);
        const cellY = Math.floor((y - this.bounds.min[1]) / this.cellSize);
        const cellZ = Math.floor((z - this.bounds.min[2]) / this.cellSize);

        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    const neighborKey = `${cellX + dx},${cellY + dy},${cellZ + dz}`;
                    if (this.grid.has(neighborKey)) {
                        neighbors.push(...this.grid.get(neighborKey));
                    }
                }
            }
        }

        return neighbors;
    }
}

/**
 * Vector math utilities optimized for particle operations
 */
const VectorUtils = {
    distance(x1, y1, z1, x2, y2, z2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dz = z2 - z1;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    },

    distanceSquared(x1, y1, z1, x2, y2, z2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dz = z2 - z1;
        return dx * dx + dy * dy + dz * dz;
    },

    normalize(x, y, z) {
        const length = Math.sqrt(x * x + y * y + z * z);
        if (length === 0) return [0, 0, 0];
        return [x / length, y / length, z / length];
    },

    length(x, y, z) {
        return Math.sqrt(x * x + y * y + z * z);
    },

    dot(x1, y1, z1, x2, y2, z2) {
        return x1 * x2 + y1 * y2 + z1 * z2;
    },

    cross(x1, y1, z1, x2, y2, z2) {
        return [
            y1 * z2 - z1 * y2,
            z1 * x2 - x1 * z2,
            x1 * y2 - y1 * x2
        ];
    }
};

/**
 * Frustum culling utilities
 */
class Frustum {
    constructor() {
        this.planes = new Array(6);
        for (let i = 0; i < 6; i++) {
            this.planes[i] = { normal: [0, 0, 0], distance: 0 };
        }
    }

    setFromMatrix(matrix) {
        const m = matrix;
        
        // Extract frustum planes from projection matrix
        // Left plane
        this.planes[0].normal[0] = m[3] + m[0];
        this.planes[0].normal[1] = m[7] + m[4];
        this.planes[0].normal[2] = m[11] + m[8];
        this.planes[0].distance = m[15] + m[12];
        
        // Right plane
        this.planes[1].normal[0] = m[3] - m[0];
        this.planes[1].normal[1] = m[7] - m[4];
        this.planes[1].normal[2] = m[11] - m[8];
        this.planes[1].distance = m[15] - m[12];
        
        // Top plane
        this.planes[2].normal[0] = m[3] - m[1];
        this.planes[2].normal[1] = m[7] - m[5];
        this.planes[2].normal[2] = m[11] - m[9];
        this.planes[2].distance = m[15] - m[13];
        
        // Bottom plane
        this.planes[3].normal[0] = m[3] + m[1];
        this.planes[3].normal[1] = m[7] + m[5];
        this.planes[3].normal[2] = m[11] + m[9];
        this.planes[3].distance = m[15] + m[13];
        
        // Near plane
        this.planes[4].normal[0] = m[3] + m[2];
        this.planes[4].normal[1] = m[7] + m[6];
        this.planes[4].normal[2] = m[11] + m[10];
        this.planes[4].distance = m[15] + m[14];
        
        // Far plane
        this.planes[5].normal[0] = m[3] - m[2];
        this.planes[5].normal[1] = m[7] - m[6];
        this.planes[5].normal[2] = m[11] - m[10];
        this.planes[5].distance = m[15] - m[14];
        
        // Normalize planes
        for (let i = 0; i < 6; i++) {
            const length = VectorUtils.length(...this.planes[i].normal);
            this.planes[i].normal[0] /= length;
            this.planes[i].normal[1] /= length;
            this.planes[i].normal[2] /= length;
            this.planes[i].distance /= length;
        }
    }

    containsPoint(x, y, z) {
        for (let i = 0; i < 6; i++) {
            const plane = this.planes[i];
            const distance = VectorUtils.dot(x, y, z, ...plane.normal) + plane.distance;
            if (distance < 0) return false;
        }
        return true;
    }

    intersectsSphere(x, y, z, radius) {
        for (let i = 0; i < 6; i++) {
            const plane = this.planes[i];
            const distance = VectorUtils.dot(x, y, z, ...plane.normal) + plane.distance;
            if (distance < -radius) return false;
        }
        return true;
    }
}

/**
 * Performance monitoring utilities
 */
class PerformanceMonitor {
    constructor(sampleSize = 100) {
        this.sampleSize = sampleSize;
        this.samples = [];
        this.totalTime = 0;
        this.avgTime = 0;
        this.minTime = Infinity;
        this.maxTime = -Infinity;
    }

    addSample(time) {
        this.samples.push(time);
        this.totalTime += time;
        
        this.minTime = Math.min(this.minTime, time);
        this.maxTime = Math.max(this.maxTime, time);
        
        if (this.samples.length > this.sampleSize) {
            const oldSample = this.samples.shift();
            this.totalTime -= oldSample;
        }
        
        this.avgTime = this.totalTime / this.samples.length;
    }

    getStats() {
        return {
            average: this.avgTime,
            min: this.minTime,
            max: this.maxTime,
            samples: this.samples.length,
            current: this.samples[this.samples.length - 1] || 0
        };
    }

    reset() {
        this.samples = [];
        this.totalTime = 0;
        this.avgTime = 0;
        this.minTime = Infinity;
        this.maxTime = -Infinity;
    }
}

/**
 * Optimized sorting algorithms for particle data
 */
const SortUtils = {
    /**
     * Quick sort with custom comparator for particle indices
     */
    quickSort(array, indices, compareFn, left = 0, right = indices.length - 1) {
        if (left < right) {
            const partitionIndex = this.partition(array, indices, compareFn, left, right);
            this.quickSort(array, indices, compareFn, left, partitionIndex - 1);
            this.quickSort(array, indices, compareFn, partitionIndex + 1, right);
        }
    },

    partition(array, indices, compareFn, left, right) {
        const pivot = indices[right];
        let i = left - 1;

        for (let j = left; j < right; j++) {
            if (compareFn(array, indices[j], pivot) <= 0) {
                i++;
                [indices[i], indices[j]] = [indices[j], indices[i]];
            }
        }

        [indices[i + 1], indices[right]] = [indices[right], indices[i + 1]];
        return i + 1;
    },

    /**
     * Radix sort for integer values (useful for grid indices)
     */
    radixSort(array, maxValue = null) {
        if (array.length <= 1) return array;
        
        if (maxValue === null) {
            maxValue = Math.max(...array);
        }
        
        let exp = 1;
        const output = new Array(array.length);
        const count = new Array(10);
        
        while (Math.floor(maxValue / exp) > 0) {
            count.fill(0);
            
            // Count occurrences
            for (let i = 0; i < array.length; i++) {
                count[Math.floor(array[i] / exp) % 10]++;
            }
            
            // Change count[i] to actual position
            for (let i = 1; i < 10; i++) {
                count[i] += count[i - 1];
            }
            
            // Build output array
            for (let i = array.length - 1; i >= 0; i--) {
                const digit = Math.floor(array[i] / exp) % 10;
                output[count[digit] - 1] = array[i];
                count[digit]--;
            }
            
            // Copy output array to array
            for (let i = 0; i < array.length; i++) {
                array[i] = output[i];
            }
            
            exp *= 10;
        }
        
        return array;
    }
};

/**
 * Memory management utilities
 */
const MemoryUtils = {
    /**
     * Create typed array pools to avoid garbage collection
     */
    createArrayPool(type, initialSize = 1000, maxPoolSize = 10) {
        const pool = [];
        const TypedArray = type;
        
        return {
            get(size) {
                if (pool.length > 0) {
                    const array = pool.pop();
                    if (array.length >= size) {
                        return array.subarray(0, size);
                    }
                }
                return new TypedArray(Math.max(size, initialSize));
            },
            
            release(array) {
                if (pool.length < maxPoolSize) {
                    pool.push(array);
                }
            },
            
            clear() {
                pool.length = 0;
            }
        };
    },

    /**
     * Estimate memory usage of typed arrays
     */
    calculateMemoryUsage(arrays) {
        let totalBytes = 0;
        
        for (const array of arrays) {
            if (array instanceof Float32Array) {
                totalBytes += array.length * 4;
            } else if (array instanceof Float64Array) {
                totalBytes += array.length * 8;
            } else if (array instanceof Uint32Array || array instanceof Int32Array) {
                totalBytes += array.length * 4;
            } else if (array instanceof Uint16Array || array instanceof Int16Array) {
                totalBytes += array.length * 2;
            } else if (array instanceof Uint8Array || array instanceof Int8Array) {
                totalBytes += array.length;
            }
        }
        
        return totalBytes;
    }
};

// Export utilities for use in workers
if (typeof self !== 'undefined') {
    self.SpatialGrid = SpatialGrid;
    self.VectorUtils = VectorUtils;
    self.Frustum = Frustum;
    self.PerformanceMonitor = PerformanceMonitor;
    self.SortUtils = SortUtils;
    self.MemoryUtils = MemoryUtils;
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SpatialGrid,
        VectorUtils,
        Frustum,
        PerformanceMonitor,
        SortUtils,
        MemoryUtils
    };
}
