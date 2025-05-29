/**
 * Utility Worker for Galaxy Simulation
 * Handles galaxy generation, data compression, and general computational tasks
 */

importScripts('/src/workers/worker-utils.js');

class UtilityWorker {
    constructor() {
        this.compressionCache = new Map();
        this.galaxyGenerationCache = new Map();
    }

    /**
     * Generate galaxy structure with spiral arms and central bulge
     */
    generateGalaxy(config) {
        const {
            particleCount = 100000,
            galaxyRadius = 2000,
            armCount = 4,
            armSeparation = 0.5,
            centralBulgeRadius = 200,
            centralBulgeParticles = 0.3,
            spiralTightness = 0.8
        } = config;

        const positions = new Float32Array(particleCount * 3);
        const velocities = new Float32Array(particleCount * 3);
        const masses = new Float32Array(particleCount);
        const types = new Uint8Array(particleCount);

        let index = 0;

        // Generate central bulge
        const bulgeCount = Math.floor(particleCount * centralBulgeParticles);
        for (let i = 0; i < bulgeCount; i++) {
            this.generateBulgeParticle(positions, velocities, masses, types, index, centralBulgeRadius);
            index++;
        }

        // Generate spiral arms
        const armParticles = Math.floor((particleCount - bulgeCount) / armCount);
        for (let arm = 0; arm < armCount; arm++) {
            for (let i = 0; i < armParticles; i++) {
                this.generateArmParticle(
                    positions, velocities, masses, types, index,
                    arm, armCount, armSeparation, spiralTightness, galaxyRadius
                );
                index++;
            }
        }

        // Fill remaining particles randomly
        while (index < particleCount) {
            this.generateRandomParticle(positions, velocities, masses, types, index, galaxyRadius);
            index++;
        }

        return {
            positions,
            velocities,
            masses,
            types,
            metadata: {
                particleCount,
                bulgeCount,
                armParticles,
                galaxyRadius
            }
        };
    }

    generateBulgeParticle(positions, velocities, masses, types, index, radius) {
        // Spherical distribution for central bulge
        const r = Math.pow(Math.random(), 0.6) * radius;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);

        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi) * 0.1; // Flatten slightly

        positions[index * 3] = x;
        positions[index * 3 + 1] = y;
        positions[index * 3 + 2] = z;

        // Orbital velocity
        const orbitalSpeed = Math.sqrt(0.1 * radius / Math.max(r, 1));
        velocities[index * 3] = -orbitalSpeed * Math.sin(theta);
        velocities[index * 3 + 1] = orbitalSpeed * Math.cos(theta);
        velocities[index * 3 + 2] = 0;

        masses[index] = 1.0 + Math.random() * 2.0; // Heavier stars in bulge
        types[index] = Math.random() < 0.3 ? 2 : 1; // 30% old stars, 70% middle-age
    }

    generateArmParticle(positions, velocities, masses, types, index, arm, armCount, separation, tightness, radius) {
        // Spiral arm generation
        const t = Math.random();
        const r = Math.pow(t, 0.7) * radius;
        const baseAngle = (arm / armCount) * Math.PI * 2;
        const spiralAngle = baseAngle + t * tightness * Math.PI * 4;

        // Add some randomness to break perfect spiral
        const angleNoise = (Math.random() - 0.5) * separation;
        const radiusNoise = (Math.random() - 0.5) * 50;

        const x = (r + radiusNoise) * Math.cos(spiralAngle + angleNoise);
        const y = (r + radiusNoise) * Math.sin(spiralAngle + angleNoise);
        const z = (Math.random() - 0.5) * 20; // Thin disk

        positions[index * 3] = x;
        positions[index * 3 + 1] = y;
        positions[index * 3 + 2] = z;

        // Orbital velocity with some random motion
        const orbitalSpeed = Math.sqrt(0.1 * radius / Math.max(r, 1));
        const randomVel = (Math.random() - 0.5) * 0.1;
        
        velocities[index * 3] = -orbitalSpeed * Math.sin(spiralAngle) + randomVel;
        velocities[index * 3 + 1] = orbitalSpeed * Math.cos(spiralAngle) + randomVel;
        velocities[index * 3 + 2] = (Math.random() - 0.5) * 0.05;

        masses[index] = 0.5 + Math.random() * 1.5;
        types[index] = Math.random() < 0.7 ? 0 : 1; // 70% young stars, 30% middle-age
    }

    generateRandomParticle(positions, velocities, masses, types, index, radius) {
        // Random halo particles
        const r = Math.random() * radius * 1.5;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);

        positions[index * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[index * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[index * 3 + 2] = (Math.random() - 0.5) * 100;

        velocities[index * 3] = (Math.random() - 0.5) * 0.2;
        velocities[index * 3 + 1] = (Math.random() - 0.5) * 0.2;
        velocities[index * 3 + 2] = (Math.random() - 0.5) * 0.1;

        masses[index] = 0.1 + Math.random() * 0.5;
        types[index] = 3; // Dark matter/gas
    }

    /**
     * Compress particle data using quantization
     */
    compressParticleData(data, precision = 16) {
        const { positions, velocities, masses } = data;
        const particleCount = positions.length / 3;

        // Find bounds for quantization
        const bounds = this.calculateBounds(positions);
        const velBounds = this.calculateBounds(velocities);
        const massBounds = { min: Math.min(...masses), max: Math.max(...masses) };

        // Quantize positions
        const quantizedPositions = new Uint16Array(positions.length);
        for (let i = 0; i < positions.length; i++) {
            const axis = i % 3;
            const range = bounds.max[axis] - bounds.min[axis];
            const normalized = (positions[i] - bounds.min[axis]) / range;
            quantizedPositions[i] = Math.floor(normalized * (Math.pow(2, precision) - 1));
        }

        // Quantize velocities (smaller precision for velocities)
        const velPrecision = Math.max(8, precision - 4);
        const quantizedVelocities = new Uint16Array(velocities.length);
        for (let i = 0; i < velocities.length; i++) {
            const axis = i % 3;
            const range = velBounds.max[axis] - velBounds.min[axis];
            const normalized = (velocities[i] - velBounds.min[axis]) / range;
            quantizedVelocities[i] = Math.floor(normalized * (Math.pow(2, velPrecision) - 1));
        }

        return {
            quantizedPositions,
            quantizedVelocities,
            masses: new Float32Array(masses), // Keep masses as float
            bounds,
            velBounds,
            massBounds,
            precision,
            velPrecision,
            particleCount
        };
    }

    /**
     * Decompress particle data
     */
    decompressParticleData(compressedData) {
        const {
            quantizedPositions, quantizedVelocities, masses,
            bounds, velBounds, precision, velPrecision, particleCount
        } = compressedData;

        const positions = new Float32Array(particleCount * 3);
        const velocities = new Float32Array(particleCount * 3);

        // Decompress positions
        for (let i = 0; i < quantizedPositions.length; i++) {
            const axis = i % 3;
            const range = bounds.max[axis] - bounds.min[axis];
            const normalized = quantizedPositions[i] / (Math.pow(2, precision) - 1);
            positions[i] = bounds.min[axis] + normalized * range;
        }

        // Decompress velocities
        for (let i = 0; i < quantizedVelocities.length; i++) {
            const axis = i % 3;
            const range = velBounds.max[axis] - velBounds.min[axis];
            const normalized = quantizedVelocities[i] / (Math.pow(2, velPrecision) - 1);
            velocities[i] = velBounds.min[axis] + normalized * range;
        }

        return { positions, velocities, masses };
    }

    calculateBounds(data) {
        const bounds = {
            min: [Infinity, Infinity, Infinity],
            max: [-Infinity, -Infinity, -Infinity]
        };

        for (let i = 0; i < data.length; i += 3) {
            for (let axis = 0; axis < 3; axis++) {
                bounds.min[axis] = Math.min(bounds.min[axis], data[i + axis]);
                bounds.max[axis] = Math.max(bounds.max[axis], data[i + axis]);
            }
        }

        return bounds;
    }

    /**
     * Calculate particle density maps for optimization
     */
    calculateDensityMap(positions, gridSize = 64) {
        const particleCount = positions.length / 3;
        const bounds = this.calculateBounds(positions);
        
        const densityGrid = new Array(gridSize * gridSize * gridSize).fill(0);
        const cellSize = [
            (bounds.max[0] - bounds.min[0]) / gridSize,
            (bounds.max[1] - bounds.min[1]) / gridSize,
            (bounds.max[2] - bounds.min[2]) / gridSize
        ];

        for (let i = 0; i < particleCount; i++) {
            const x = positions[i * 3];
            const y = positions[i * 3 + 1];
            const z = positions[i * 3 + 2];

            const gridX = Math.floor((x - bounds.min[0]) / cellSize[0]);
            const gridY = Math.floor((y - bounds.min[1]) / cellSize[1]);
            const gridZ = Math.floor((z - bounds.min[2]) / cellSize[2]);

            if (gridX >= 0 && gridX < gridSize &&
                gridY >= 0 && gridY < gridSize &&
                gridZ >= 0 && gridZ < gridSize) {
                const index = gridZ * gridSize * gridSize + gridY * gridSize + gridX;
                densityGrid[index]++;
            }
        }

        return {
            densityGrid,
            gridSize,
            cellSize,
            bounds
        };
    }
}

const worker = new UtilityWorker();

self.addEventListener('message', async (event) => {
    const { taskId, type, data } = event.data;
    const startTime = performance.now();

    try {
        let result;

        switch (type) {
            case 'generateGalaxy':
                result = worker.generateGalaxy(data);
                break;
            case 'compressData':
                result = worker.compressParticleData(data.particleData, data.precision);
                break;
            case 'decompressData':
                result = worker.decompressParticleData(data);
                break;
            case 'calculateDensity':
                result = worker.calculateDensityMap(data.positions, data.gridSize);
                break;
            default:
                throw new Error(`Unknown task type: ${type}`);
        }

        const executionTime = performance.now() - startTime;
        
        self.postMessage({
            taskId,
            type,
            result,
            executionTime
        });

    } catch (error) {
        self.postMessage({
            taskId,
            type,
            error: error.message,
            executionTime: performance.now() - startTime
        });
    }
});
