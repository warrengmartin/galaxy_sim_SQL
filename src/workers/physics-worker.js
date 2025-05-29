/**
 * Physics Worker for Galaxy Simulation
 * Handles gravity calculations, spatial partitioning, and particle interactions
 */

// Import any utility functions needed
import { calculateDistance, normalizeVector } from './worker-utils.js';

class PhysicsWorker {
    constructor() {
        this.initialized = false;
        this.config = {};
        this.spatialGrid = new Map();
        this.gridSize = 50;
    }
    
    initialize(config) {
        this.config = {
            gravity: 225.0,
            timeStep: 0.0001,
            interactionRate: 0.05,
            blackHoleForce: 100.0,
            maxAcceleration: 2.0,
            ...config
        };
        this.initialized = true;
    }
    
    /**
     * Calculate gravity forces for a subset of particles
     */
    calculateGravity(particleSubset, allParticles, config = {}) {
        const startTime = performance.now();
        
        if (!this.initialized) {
            this.initialize(config);
        }
        
        const results = [];
        const gravity = config.gravity || this.config.gravity;
        const interactionRate = config.interactionRate || this.config.interactionRate;
        const blackHoleForce = config.blackHoleForce || this.config.blackHoleForce;
        
        // Calculate total particles to check (optimization)
        const totalParticles = allParticles.length / 4; // 4 floats per particle
        const particlesToCheck = Math.floor(totalParticles * interactionRate);
        
        for (let i = 0; i < particleSubset.length; i += 4) {
            const pos1 = {
                x: particleSubset[i],
                y: particleSubset[i + 1],
                z: particleSubset[i + 2],
                type: particleSubset[i + 3]
            };
            
            let acceleration = { x: 0, y: 0, z: 0 };
            let accMagnitude = 0;
            
            // Sample interactions with other particles
            for (let j = 0; j < particlesToCheck * 4; j += 4) {
                const pos2 = {
                    x: allParticles[j],
                    y: allParticles[j + 1],
                    z: allParticles[j + 2],
                    type: allParticles[j + 3]
                };
                
                // Skip self-interaction
                if (pos1.x === pos2.x && pos1.y === pos2.y && pos1.z === pos2.z) {
                    continue;
                }
                
                const dx = pos2.x - pos1.x;
                const dy = pos2.y - pos1.y;
                const dz = pos2.z - pos1.z;
                
                const distanceSquared = dx * dx + dy * dy + dz * dz + 1.0; // Add 1 to prevent division by zero
                const distance = Math.sqrt(distanceSquared);
                
                let gravityField = gravity / distanceSquared;
                gravityField = Math.min(gravityField, 1.0);
                
                // Special handling for black hole (at origin)
                if (pos2.x === 0 && pos2.y === 0 && pos2.z === 0) {
                    gravityField = gravity * blackHoleForce / distanceSquared;
                }
                
                // Add normalized force
                const normalizedForce = {
                    x: (dx / distance) * gravityField,
                    y: (dy / distance) * gravityField,
                    z: (dz / distance) * gravityField
                };
                
                acceleration.x += normalizedForce.x;
                acceleration.y += normalizedForce.y;
                acceleration.z += normalizedForce.z;
            }
            
            // Calculate acceleration magnitude for color coding
            accMagnitude = Math.sqrt(
                acceleration.x * acceleration.x + 
                acceleration.y * acceleration.y + 
                acceleration.z * acceleration.z
            );
            
            // Clamp acceleration magnitude
            if (accMagnitude > this.config.maxAcceleration) {
                const scale = this.config.maxAcceleration / accMagnitude;
                acceleration.x *= scale;
                acceleration.y *= scale;
                acceleration.z *= scale;
                accMagnitude = this.config.maxAcceleration;
            }
            
            results.push({
                index: i / 4,
                acceleration,
                magnitude: accMagnitude
            });
        }
        
        const executionTime = performance.now() - startTime;
        
        return {
            results,
            executionTime,
            particlesProcessed: particleSubset.length / 4
        };
    }
    
    /**
     * Update spatial grid for efficient neighbor finding
     */
    updateSpatialGrid(particles, gridSize = 50) {
        const startTime = performance.now();
        
        this.gridSize = gridSize;
        this.spatialGrid.clear();
        
        for (let i = 0; i < particles.length; i += 4) {
            const x = particles[i];
            const y = particles[i + 1];
            const z = particles[i + 2];
            
            const cellX = Math.floor(x / gridSize);
            const cellY = Math.floor(y / gridSize);
            const cellZ = Math.floor(z / gridSize);
            const cellKey = `${cellX},${cellY},${cellZ}`;
            
            if (!this.spatialGrid.has(cellKey)) {
                this.spatialGrid.set(cellKey, []);
            }
            
            this.spatialGrid.get(cellKey).push({
                index: i / 4,
                x, y, z,
                cellX, cellY, cellZ
            });
        }
        
        const executionTime = performance.now() - startTime;
        
        return {
            cellCount: this.spatialGrid.size,
            executionTime,
            particlesProcessed: particles.length / 4
        };
    }
    
    /**
     * Calculate optimized gravity using spatial grid
     */
    calculateGravityWithGrid(particleIndex, particles, maxRange = 3) {
        const startTime = performance.now();
        
        const i = particleIndex * 4;
        const pos = {
            x: particles[i],
            y: particles[i + 1],
            z: particles[i + 2]
        };
        
        const cellX = Math.floor(pos.x / this.gridSize);
        const cellY = Math.floor(pos.y / this.gridSize);
        const cellZ = Math.floor(pos.z / this.gridSize);
        
        let acceleration = { x: 0, y: 0, z: 0 };
        
        // Check neighboring cells
        for (let dx = -maxRange; dx <= maxRange; dx++) {
            for (let dy = -maxRange; dy <= maxRange; dy++) {
                for (let dz = -maxRange; dz <= maxRange; dz++) {
                    const neighborKey = `${cellX + dx},${cellY + dy},${cellZ + dz}`;
                    const neighbors = this.spatialGrid.get(neighborKey);
                    
                    if (!neighbors) continue;
                    
                    for (const neighbor of neighbors) {
                        if (neighbor.index === particleIndex) continue;
                        
                        const dx = neighbor.x - pos.x;
                        const dy = neighbor.y - pos.y;
                        const dz = neighbor.z - pos.z;
                        
                        const distanceSquared = dx * dx + dy * dy + dz * dz + 1.0;
                        const distance = Math.sqrt(distanceSquared);
                        
                        let gravityField = this.config.gravity / distanceSquared;
                        gravityField = Math.min(gravityField, 1.0);
                        
                        acceleration.x += (dx / distance) * gravityField;
                        acceleration.y += (dy / distance) * gravityField;
                        acceleration.z += (dz / distance) * gravityField;
                    }
                }
            }
        }
        
        const magnitude = Math.sqrt(
            acceleration.x * acceleration.x + 
            acceleration.y * acceleration.y + 
            acceleration.z * acceleration.z
        );
        
        const executionTime = performance.now() - startTime;
        
        return {
            acceleration,
            magnitude,
            executionTime
        };
    }
    
    /**
     * Simulate collision detection between particles
     */
    detectCollisions(particles, threshold = 1.0) {
        const startTime = performance.now();
        const collisions = [];
        
        for (let i = 0; i < particles.length; i += 4) {
            const pos1 = {
                x: particles[i],
                y: particles[i + 1],
                z: particles[i + 2],
                index: i / 4
            };
            
            // Check within spatial grid cell and neighbors
            const cellX = Math.floor(pos1.x / this.gridSize);
            const cellY = Math.floor(pos1.y / this.gridSize);
            const cellZ = Math.floor(pos1.z / this.gridSize);
            
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dz = -1; dz <= 1; dz++) {
                        const cellKey = `${cellX + dx},${cellY + dy},${cellZ + dz}`;
                        const neighbors = this.spatialGrid.get(cellKey);
                        
                        if (!neighbors) continue;
                        
                        for (const neighbor of neighbors) {
                            if (neighbor.index <= pos1.index) continue;
                            
                            const distance = Math.sqrt(
                                (neighbor.x - pos1.x) ** 2 +
                                (neighbor.y - pos1.y) ** 2 +
                                (neighbor.z - pos1.z) ** 2
                            );
                            
                            if (distance < threshold) {
                                collisions.push({
                                    particle1: pos1.index,
                                    particle2: neighbor.index,
                                    distance
                                });
                            }
                        }
                    }
                }
            }
        }
        
        const executionTime = performance.now() - startTime;
        
        return {
            collisions,
            executionTime,
            collisionCount: collisions.length
        };
    }
    
    /**
     * Calculate particle density in regions for adaptive LOD
     */
    calculateDensityMap(particles, regionSize = 100) {
        const startTime = performance.now();
        const densityMap = new Map();
        
        for (let i = 0; i < particles.length; i += 4) {
            const x = particles[i];
            const y = particles[i + 1];
            const z = particles[i + 2];
            
            const regionX = Math.floor(x / regionSize);
            const regionY = Math.floor(y / regionSize);
            const regionZ = Math.floor(z / regionSize);
            const regionKey = `${regionX},${regionY},${regionZ}`;
            
            densityMap.set(regionKey, (densityMap.get(regionKey) || 0) + 1);
        }
        
        const executionTime = performance.now() - startTime;
        
        return {
            densityMap: Object.fromEntries(densityMap),
            executionTime,
            regions: densityMap.size
        };
    }
}

// Worker message handling
const physicsWorker = new PhysicsWorker();

self.onmessage = function(event) {
    const { taskId, type, ...data } = event.data;
    const startTime = performance.now();
    
    try {
        let result;
        
        switch (type) {
            case 'CALCULATE_GRAVITY':
                result = physicsWorker.calculateGravity(
                    data.particleSubset,
                    data.allParticles,
                    data.config
                );
                break;
                
            case 'UPDATE_SPATIAL_GRID':
                result = physicsWorker.updateSpatialGrid(
                    data.particles,
                    data.gridSize
                );
                break;
                
            case 'CALCULATE_GRAVITY_WITH_GRID':
                result = physicsWorker.calculateGravityWithGrid(
                    data.particleIndex,
                    data.particles,
                    data.maxRange
                );
                break;
                
            case 'DETECT_COLLISIONS':
                result = physicsWorker.detectCollisions(
                    data.particles,
                    data.threshold
                );
                break;
                
            case 'CALCULATE_DENSITY':
                result = physicsWorker.calculateDensityMap(
                    data.particles,
                    data.regionSize
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
