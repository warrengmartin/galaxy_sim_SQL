/**
 * Galaxy Simulation Integration Layer
 * Orchestrates batching, workers, and rendering for optimal performance
 */

import { ParticleBatchManager } from './ParticleBatchManager.js';
import { GalaxyWorkerPool } from './GalaxyWorkerPool.js';
import { AdvancedBatchRenderer } from './AdvancedBatchRenderer.js';

export class GalaxyOptimizationEngine {
    constructor(scene, camera, renderer, config = {}) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        
        this.config = {
            // Worker configuration
            enableWorkers: config.enableWorkers !== false,
            physicsWorkers: config.physicsWorkers || Math.min(navigator.hardwareConcurrency || 4, 6),
            renderWorkers: config.renderWorkers || 2,
            
            // Batching configuration
            enableBatching: config.enableBatching !== false,
            batchSize: config.batchSize || 25000,
            maxDrawCalls: config.maxDrawCalls || 32,
            
            // Performance configuration
            targetFPS: config.targetFPS || 60,
            adaptiveQuality: config.adaptiveQuality !== false,
            enableProfiling: config.enableProfiling !== false,
            
            // Simulation configuration
            particleCount: config.particleCount || 100000,
            enablePhysics: config.enablePhysics !== false,
            simulationSpeed: config.simulationSpeed || 1.0,
            
            ...config
        };

        this.particleData = null;
        this.frameCount = 0;
        this.lastFrameTime = 0;
        this.averageFPS = 60;
        this.performanceMetrics = new Map();
        
        this.initializeComponents();
        this.setupEventListeners();
    }

    async initializeComponents() {
        // Initialize worker pool
        if (this.config.enableWorkers) {
            this.workerPool = new GalaxyWorkerPool({
                physicsWorkers: this.config.physicsWorkers,
                renderWorkers: this.config.renderWorkers,
                utilityWorkers: 1
            });
            
            await this.workerPool.initialize();
        }

        // Initialize batch manager
        if (this.config.enableBatching) {
            this.batchManager = new ParticleBatchManager(null, {
                chunkSize: this.config.batchSize,
                enableFrustumCulling: true,
                enableDepthSorting: true
            });
        }

        // Initialize advanced renderer
        this.batchRenderer = new AdvancedBatchRenderer(this.scene, this.camera, this.renderer, {
            maxBatchSize: this.config.batchSize,
            maxDrawCalls: this.config.maxDrawCalls,
            enableDepthSorting: true
        });

        // Generate initial galaxy
        await this.generateGalaxy();
    }

    async generateGalaxy() {
        if (this.workerPool) {
            // Use worker for galaxy generation
            const galaxyData = await this.workerPool.executeTask('utility', 'generateGalaxy', {
                particleCount: this.config.particleCount,
                galaxyRadius: 2000,
                armCount: 4,
                spiralTightness: 0.8
            });
            
            this.particleData = galaxyData;
        } else {
            // Fallback to local generation
            this.particleData = this.generateGalaxyLocal();
        }

        // Initialize spatial structures
        if (this.batchManager) {
            this.batchManager.initializeFromData(this.particleData);
        }
    }

    generateGalaxyLocal() {
        // Simple local galaxy generation
        const count = this.config.particleCount;
        const positions = new Float32Array(count * 3);
        const velocities = new Float32Array(count * 3);
        const masses = new Float32Array(count);
        const types = new Uint8Array(count);

        for (let i = 0; i < count; i++) {
            // Simple spiral galaxy generation
            const t = i / count;
            const r = Math.pow(t, 0.7) * 1500;
            const theta = t * Math.PI * 8;
            
            positions[i * 3] = r * Math.cos(theta) + (Math.random() - 0.5) * 100;
            positions[i * 3 + 1] = r * Math.sin(theta) + (Math.random() - 0.5) * 100;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 50;
            
            velocities[i * 3] = -Math.sin(theta) * Math.sqrt(r * 0.001);
            velocities[i * 3 + 1] = Math.cos(theta) * Math.sqrt(r * 0.001);
            velocities[i * 3 + 2] = 0;
            
            masses[i] = 0.5 + Math.random() * 1.5;
            types[i] = Math.floor(Math.random() * 4);
        }

        return { positions, velocities, masses, types };
    }

    setupEventListeners() {
        // Handle window resize
        window.addEventListener('resize', () => {
            this.handleResize();
        });

        // Performance monitoring
        if (this.config.enableProfiling) {
            this.setupPerformanceMonitoring();
        }
    }

    handleResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    setupPerformanceMonitoring() {
        // Track frame times
        this.frameTimer = {
            start: 0,
            samples: [],
            sampleSize: 60
        };
    }

    /**
     * Main update loop
     */
    async update(deltaTime) {
        const startTime = performance.now();
        
        // Update physics if enabled
        if (this.config.enablePhysics) {
            await this.updatePhysics(deltaTime);
        }

        // Update batching and culling
        const visibleParticles = await this.updateCulling();
        
        // Update rendering
        this.updateRendering(visibleParticles);
        
        // Adaptive quality based on performance
        if (this.config.adaptiveQuality) {
            this.updateAdaptiveQuality();
        }

        // Performance tracking
        if (this.config.enableProfiling) {
            this.trackPerformance(performance.now() - startTime);
        }
    }

    async updatePhysics(deltaTime) {
        if (!this.workerPool || !this.particleData) return;

        try {
            // Distribute physics calculations across workers
            const chunkSize = Math.ceil(this.particleData.positions.length / (3 * this.config.physicsWorkers));
            const physicsPromises = [];

            for (let i = 0; i < this.config.physicsWorkers; i++) {
                const startIdx = i * chunkSize;
                const endIdx = Math.min(startIdx + chunkSize, this.particleData.positions.length / 3);
                
                if (startIdx < endIdx) {
                    physicsPromises.push(
                        this.workerPool.executeTask('physics', 'updateParticles', {
                            positions: this.particleData.positions.slice(startIdx * 3, endIdx * 3),
                            velocities: this.particleData.velocities.slice(startIdx * 3, endIdx * 3),
                            masses: this.particleData.masses.slice(startIdx, endIdx),
                            deltaTime: deltaTime * this.config.simulationSpeed,
                            startIndex: startIdx
                        })
                    );
                }
            }

            // Wait for all physics updates
            const results = await Promise.all(physicsPromises);
            
            // Merge results back
            for (const result of results) {
                const { positions, velocities, startIndex } = result;
                const startIdx = startIndex * 3;
                
                for (let i = 0; i < positions.length; i++) {
                    this.particleData.positions[startIdx + i] = positions[i];
                    this.particleData.velocities[startIdx + i] = velocities[i];
                }
            }
        } catch (error) {
            console.warn('Physics update failed, falling back to single-threaded:', error);
            this.updatePhysicsLocal(deltaTime);
        }
    }

    updatePhysicsLocal(deltaTime) {
        // Simple local physics update
        const dt = deltaTime * this.config.simulationSpeed;
        const positions = this.particleData.positions;
        const velocities = this.particleData.velocities;
        
        for (let i = 0; i < positions.length; i += 3) {
            positions[i] += velocities[i] * dt;
            positions[i + 1] += velocities[i + 1] * dt;
            positions[i + 2] += velocities[i + 2] * dt;
        }
    }

    async updateCulling() {
        if (!this.particleData) return [];

        try {
            if (this.workerPool) {
                // Use worker for frustum culling
                const result = await this.workerPool.executeTask('render', 'frustumCull', {
                    positions: this.particleData.positions,
                    cameraMatrix: this.camera.matrixWorldInverse.elements,
                    projectionMatrix: this.camera.projectionMatrix.elements,
                    cullDistance: 5000
                });
                
                return result.visibleIndices;
            }
        } catch (error) {
            console.warn('Worker culling failed, using local culling:', error);
        }

        // Fallback to local culling
        return this.updateCullingLocal();
    }

    updateCullingLocal() {
        const visibleIndices = [];
        const positions = this.particleData.positions;
        const cameraPos = this.camera.position;
        const cullDistanceSq = 5000 * 5000;

        for (let i = 0; i < positions.length; i += 3) {
            const dx = positions[i] - cameraPos.x;
            const dy = positions[i + 1] - cameraPos.y;
            const dz = positions[i + 2] - cameraPos.z;
            const distSq = dx * dx + dy * dy + dz * dz;

            if (distSq < cullDistanceSq) {
                visibleIndices.push(i / 3);
            }
        }

        return visibleIndices;
    }

    updateRendering(visibleParticles) {
        if (!this.particleData || !visibleParticles.length) return;

        // Update batch renderer with visible particles
        this.batchRenderer.updateBatches(this.particleData, visibleParticles);
        
        // Update material uniforms
        this.batchRenderer.updateUniforms(this.frameCount * 0.016);
        
        // Render batches
        const drawCalls = this.batchRenderer.render();
        
        this.performanceMetrics.set('drawCalls', drawCalls);
        this.performanceMetrics.set('visibleParticles', visibleParticles.length);
    }

    updateAdaptiveQuality() {
        const currentFPS = this.averageFPS;
        const targetFPS = this.config.targetFPS;
        
        if (currentFPS < targetFPS * 0.8) {
            // Reduce quality
            this.config.batchSize = Math.min(this.config.batchSize + 5000, 50000);
            this.config.maxDrawCalls = Math.max(this.config.maxDrawCalls - 2, 16);
        } else if (currentFPS > targetFPS * 1.1) {
            // Increase quality
            this.config.batchSize = Math.max(this.config.batchSize - 2000, 10000);
            this.config.maxDrawCalls = Math.min(this.config.maxDrawCalls + 1, 64);
        }
    }

    trackPerformance(frameTime) {
        this.frameTimer.samples.push(frameTime);
        
        if (this.frameTimer.samples.length > this.frameTimer.sampleSize) {
            this.frameTimer.samples.shift();
        }
        
        const avgFrameTime = this.frameTimer.samples.reduce((a, b) => a + b, 0) / this.frameTimer.samples.length;
        this.averageFPS = 1000 / avgFrameTime;
        
        this.performanceMetrics.set('fps', this.averageFPS);
        this.performanceMetrics.set('frameTime', frameTime);
        
        this.frameCount++;
    }

    /**
     * Get performance statistics
     */
    getPerformanceStats() {
        const stats = {
            fps: this.averageFPS,
            frameTime: this.performanceMetrics.get('frameTime') || 0,
            drawCalls: this.performanceMetrics.get('drawCalls') || 0,
            visibleParticles: this.performanceMetrics.get('visibleParticles') || 0,
            totalParticles: this.particleData ? this.particleData.positions.length / 3 : 0,
            workers: this.workerPool ? {
                physics: this.config.physicsWorkers,
                render: this.config.renderWorkers,
                utility: 1
            } : null,
            batching: this.batchRenderer ? this.batchRenderer.getStats() : null
        };

        return stats;
    }

    /**
     * Debug information for development
     */
    getDebugInfo() {
        return {
            config: this.config,
            performance: this.getPerformanceStats(),
            workerStats: this.workerPool ? this.workerPool.getWorkerStats() : null,
            memoryUsage: this.estimateMemoryUsage()
        };
    }

    estimateMemoryUsage() {
        if (!this.particleData) return 0;
        
        const particleCount = this.particleData.positions.length / 3;
        const bytesPerParticle = 4 * 3 + 4 * 3 + 4 + 1; // pos + vel + mass + type
        
        return {
            particles: particleCount * bytesPerParticle,
            estimated: `${Math.round(particleCount * bytesPerParticle / 1024 / 1024)} MB`
        };
    }

    /**
     * Clean up resources
     */
    dispose() {
        if (this.workerPool) {
            this.workerPool.dispose();
        }
        
        if (this.batchRenderer) {
            this.batchRenderer.dispose();
        }
        
        if (this.batchManager) {
            this.batchManager.dispose();
        }
    }
}
