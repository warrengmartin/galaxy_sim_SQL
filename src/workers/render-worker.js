/**
 * Render Worker for Galaxy Simulation
 * Handles LOD calculations, frustum culling, and particle sorting
 */

class RenderWorker {
    constructor() {
        this.initialized = false;
        this.lodRanges = [
            { max: 1000, density: 1.0, pointSize: 2.0 },
            { max: 3000, density: 0.6, pointSize: 1.5 },
            { max: 8000, density: 0.3, pointSize: 1.0 },
            { max: Infinity, density: 0.1, pointSize: 0.5 }
        ];
    }
    
    initialize(config) {
        this.config = {
            cullDistance: 10000,
            maxParticlesPerChunk: 10000,
            lodTransitionSmoothness: 0.2,
            ...config
        };
        this.initialized = true;
    }
    
    /**
     * Calculate LOD levels for particle chunks based on distance from camera
     */
    calculateLOD(chunks, cameraPosition) {
        const startTime = performance.now();
        
        if (!this.initialized) {
            this.initialize();
        }
        
        const results = [];
        
        for (const chunk of chunks) {
            const distance = this.calculateDistance(
                cameraPosition,
                chunk.centroid || chunk.center
            );
            
            // Determine LOD level
            let lodLevel = 0;
            for (let i = 0; i < this.lodRanges.length; i++) {
                if (distance <= this.lodRanges[i].max) {
                    lodLevel = i;
                    break;
                }
                lodLevel = i;
            }
            
            // Calculate transition alpha for smooth LOD changes
            const lodConfig = this.lodRanges[lodLevel];
            const prevLodConfig = lodLevel > 0 ? this.lodRanges[lodLevel - 1] : null;
            
            let transitionAlpha = 1.0;
            if (prevLodConfig) {
                const transitionRange = lodConfig.max - prevLodConfig.max;
                const transitionPosition = (distance - prevLodConfig.max) / transitionRange;
                transitionAlpha = Math.max(0, Math.min(1, 1 - transitionPosition));
            }
            
            // Calculate effective particle count based on LOD
            const baseParticleCount = chunk.particleCount || chunk.count || 0;
            const effectiveParticleCount = Math.floor(
                baseParticleCount * lodConfig.density * transitionAlpha
            );
            
            results.push({
                chunkId: chunk.id,
                distance,
                lodLevel,
                transitionAlpha,
                effectiveParticleCount,
                visible: distance < this.config.cullDistance,
                pointSize: lodConfig.pointSize,
                density: lodConfig.density
            });
        }
        
        const executionTime = performance.now() - startTime;
        
        return {
            results,
            executionTime,
            chunksProcessed: chunks.length
        };
    }
    
    /**
     * Perform frustum culling on chunks
     */
    frustumCull(chunks, frustumPlanes) {
        const startTime = performance.now();
        
        const results = [];
        let culledCount = 0;
        
        for (const chunk of chunks) {
            const boundingSphere = chunk.boundingSphere || {
                center: chunk.center || chunk.centroid,
                radius: chunk.radius || 50
            };
            
            let visible = true;
            
            // Test against each frustum plane
            for (const plane of frustumPlanes) {
                const distance = this.distanceToPlane(boundingSphere.center, plane);
                
                if (distance < -boundingSphere.radius) {
                    visible = false;
                    culledCount++;
                    break;
                }
            }
            
            results.push({
                chunkId: chunk.id,
                visible,
                culled: !visible
            });
        }
        
        const executionTime = performance.now() - startTime;
        
        return {
            results,
            executionTime,
            chunksProcessed: chunks.length,
            culledCount,
            visibleCount: chunks.length - culledCount
        };
    }
    
    /**
     * Sort particles by distance for proper alpha blending
     */
    sortParticles(particles, cameraPosition) {
        const startTime = performance.now();
        
        // Create array of particle indices with distances
        const particleData = [];
        
        for (let i = 0; i < particles.length; i += 4) {
            const distance = this.calculateDistance(cameraPosition, {
                x: particles[i],
                y: particles[i + 1],
                z: particles[i + 2]
            });
            
            particleData.push({
                index: i / 4,
                distance,
                x: particles[i],
                y: particles[i + 1],
                z: particles[i + 2],
                w: particles[i + 3]
            });
        }
        
        // Sort by distance (far to near for additive blending)
        particleData.sort((a, b) => b.distance - a.distance);
        
        // Create sorted indices array
        const sortedIndices = particleData.map(p => p.index);
        
        const executionTime = performance.now() - startTime;
        
        return {
            sortedIndices,
            executionTime,
            particlesProcessed: particles.length / 4
        };
    }
    
    /**
     * Calculate screen-space particle sizes for consistent appearance
     */
    calculateScreenSizes(particles, camera, viewport) {
        const startTime = performance.now();
        
        const results = [];
        const cameraConstant = viewport.height / (Math.tan(camera.fov * 0.5 * Math.PI / 180) / camera.zoom);
        
        for (let i = 0; i < particles.length; i += 4) {
            const worldPos = {
                x: particles[i],
                y: particles[i + 1],
                z: particles[i + 2]
            };
            
            // Transform to camera space (simplified)
            const distance = this.calculateDistance(camera.position, worldPos);
            const screenSize = cameraConstant / distance;
            
            results.push({
                particleIndex: i / 4,
                worldDistance: distance,
                screenSize: Math.max(0.5, Math.min(10.0, screenSize)) // Clamp size
            });
        }
        
        const executionTime = performance.now() - startTime;
        
        return {
            results,
            executionTime,
            particlesProcessed: particles.length / 4
        };
    }
    
    /**
     * Group particles by material type for batched rendering
     */
    groupParticlesByType(particles) {
        const startTime = performance.now();
        
        const groups = new Map();
        
        for (let i = 0; i < particles.length; i += 4) {
            const type = particles[i + 3]; // Assuming type is stored in w component
            
            if (!groups.has(type)) {
                groups.set(type, []);
            }
            
            groups.get(type).push({
                index: i / 4,
                x: particles[i],
                y: particles[i + 1],
                z: particles[i + 2]
            });
        }
        
        const executionTime = performance.now() - startTime;
        
        return {
            groups: Object.fromEntries(groups),
            executionTime,
            particlesProcessed: particles.length / 4,
            groupCount: groups.size
        };
    }
    
    /**
     * Calculate optimal chunk boundaries for spatial partitioning
     */
    calculateOptimalChunks(particles, targetChunkSize = 10000) {
        const startTime = performance.now();
        
        // Find bounding box
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        
        for (let i = 0; i < particles.length; i += 4) {
            const x = particles[i];
            const y = particles[i + 1];
            const z = particles[i + 2];
            
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            minZ = Math.min(minZ, z);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            maxZ = Math.max(maxZ, z);
        }
        
        const totalParticles = particles.length / 4;
        const targetChunks = Math.ceil(totalParticles / targetChunkSize);
        
        // Calculate grid dimensions
        const volume = (maxX - minX) * (maxY - minY) * (maxZ - minZ);
        const chunkVolume = volume / targetChunks;
        const chunkSize = Math.cbrt(chunkVolume);
        
        const chunksX = Math.ceil((maxX - minX) / chunkSize);
        const chunksY = Math.ceil((maxY - minY) / chunkSize);
        const chunksZ = Math.ceil((maxZ - minZ) / chunkSize);
        
        const chunks = [];
        
        for (let x = 0; x < chunksX; x++) {
            for (let y = 0; y < chunksY; y++) {
                for (let z = 0; z < chunksZ; z++) {
                    const bounds = {
                        minX: minX + x * chunkSize,
                        maxX: minX + (x + 1) * chunkSize,
                        minY: minY + y * chunkSize,
                        maxY: minY + (y + 1) * chunkSize,
                        minZ: minZ + z * chunkSize,
                        maxZ: minZ + (z + 1) * chunkSize
                    };
                    
                    chunks.push({
                        id: `${x}-${y}-${z}`,
                        bounds,
                        center: {
                            x: (bounds.minX + bounds.maxX) / 2,
                            y: (bounds.minY + bounds.maxY) / 2,
                            z: (bounds.minZ + bounds.maxZ) / 2
                        },
                        particles: []
                    });
                }
            }
        }
        
        // Assign particles to chunks
        for (let i = 0; i < particles.length; i += 4) {
            const x = particles[i];
            const y = particles[i + 1];
            const z = particles[i + 2];
            
            const chunkX = Math.floor((x - minX) / chunkSize);
            const chunkY = Math.floor((y - minY) / chunkSize);
            const chunkZ = Math.floor((z - minZ) / chunkSize);
            
            const chunkIndex = chunkX * chunksY * chunksZ + chunkY * chunksZ + chunkZ;
            
            if (chunkIndex >= 0 && chunkIndex < chunks.length) {
                chunks[chunkIndex].particles.push(i / 4);
            }
        }
        
        // Filter out empty chunks
        const nonEmptyChunks = chunks.filter(chunk => chunk.particles.length > 0);
        
        const executionTime = performance.now() - startTime;
        
        return {
            chunks: nonEmptyChunks,
            executionTime,
            particlesProcessed: particles.length / 4,
            chunkCount: nonEmptyChunks.length
        };
    }
    
    // Utility methods
    
    calculateDistance(pos1, pos2) {
        const dx = pos1.x - pos2.x;
        const dy = pos1.y - pos2.y;
        const dz = pos1.z - pos2.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    
    distanceToPlane(point, plane) {
        return plane.normal.x * point.x + 
               plane.normal.y * point.y + 
               plane.normal.z * point.z + 
               plane.constant;
    }
    
    /**
     * Calculate visibility mask for particles based on multiple criteria
     */
    calculateVisibilityMask(particles, camera, frustumPlanes, lodLevel = 0) {
        const startTime = performance.now();
        
        const visibilityMask = new Uint8Array(particles.length / 4);
        const lodConfig = this.lodRanges[lodLevel];
        
        for (let i = 0; i < particles.length; i += 4) {
            const pos = {
                x: particles[i],
                y: particles[i + 1],
                z: particles[i + 2]
            };
            
            // Distance culling
            const distance = this.calculateDistance(camera.position, pos);
            if (distance > this.config.cullDistance) {
                visibilityMask[i / 4] = 0;
                continue;
            }
            
            // Frustum culling (simplified point test)
            let inFrustum = true;
            for (const plane of frustumPlanes) {
                if (this.distanceToPlane(pos, plane) < 0) {
                    inFrustum = false;
                    break;
                }
            }
            
            if (!inFrustum) {
                visibilityMask[i / 4] = 0;
                continue;
            }
            
            // LOD density culling
            if (Math.random() > lodConfig.density) {
                visibilityMask[i / 4] = 0;
                continue;
            }
            
            visibilityMask[i / 4] = 1;
        }
        
        const executionTime = performance.now() - startTime;
        
        return {
            visibilityMask: Array.from(visibilityMask),
            executionTime,
            particlesProcessed: particles.length / 4,
            visibleCount: visibilityMask.reduce((sum, val) => sum + val, 0)
        };
    }
}

// Worker message handling
const renderWorker = new RenderWorker();

self.onmessage = function(event) {
    const { taskId, type, ...data } = event.data;
    const startTime = performance.now();
    
    try {
        let result;
        
        switch (type) {
            case 'CALCULATE_LOD':
                result = renderWorker.calculateLOD(
                    data.chunks,
                    data.cameraPosition
                );
                break;
                
            case 'FRUSTUM_CULL':
                result = renderWorker.frustumCull(
                    data.chunks,
                    data.frustumPlanes
                );
                break;
                
            case 'SORT_PARTICLES':
                result = renderWorker.sortParticles(
                    data.particles,
                    data.cameraPosition
                );
                break;
                
            case 'CALCULATE_SCREEN_SIZES':
                result = renderWorker.calculateScreenSizes(
                    data.particles,
                    data.camera,
                    data.viewport
                );
                break;
                
            case 'GROUP_PARTICLES_BY_TYPE':
                result = renderWorker.groupParticlesByType(
                    data.particles
                );
                break;
                
            case 'CALCULATE_OPTIMAL_CHUNKS':
                result = renderWorker.calculateOptimalChunks(
                    data.particles,
                    data.targetChunkSize
                );
                break;
                
            case 'CALCULATE_VISIBILITY_MASK':
                result = renderWorker.calculateVisibilityMask(
                    data.particles,
                    data.camera,
                    data.frustumPlanes,
                    data.lodLevel
                );
                break;
                
            default:
                throw new Error(`Unknown task type: ${type}`);
        }
        
        const executionTime = performance.now() - startTime;
        
        self.postMessage({
            taskId,
            type,
            result,
            executionTime,
            success: true
        });
        
    } catch (error) {
        const executionTime = performance.now() - startTime;
        
        self.postMessage({
            taskId,
            type,
            error: error.message,
            executionTime,
            success: false
        });
    }
};
