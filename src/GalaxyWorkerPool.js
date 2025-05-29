/**
 * Web Worker Pool for Galaxy Simulation
 * Handles multi-threaded physics calculations and rendering preparation
 */

export class GalaxyWorkerPool {
    constructor(config = {}) {
        this.config = {
            physicsWorkers: config.physicsWorkers || Math.min(navigator.hardwareConcurrency || 4, 6),
            renderWorkers: config.renderWorkers || 2,
            utilityWorkers: config.utilityWorkers || 1,
            maxQueueSize: config.maxQueueSize || 1000,
            ...config
        };
        
        this.workers = {
            physics: [],
            render: [],
            utility: []
        };
        
        this.queues = {
            physics: [],
            render: [],
            utility: []
        };
        
        this.taskId = 0;
        this.pendingTasks = new Map();
        this.workerStats = new Map();
        
        this.initializeWorkers();
    }
    
    initializeWorkers() {
        // Physics workers for gravity calculations and particle interactions
        for (let i = 0; i < this.config.physicsWorkers; i++) {
            this.createWorker('physics', '/src/workers/physics-worker.js', i);
        }
        
        // Render workers for LOD calculations and culling
        for (let i = 0; i < this.config.renderWorkers; i++) {
            this.createWorker('render', '/src/workers/render-worker.js', i);
        }
        
        // Utility workers for misc tasks
        for (let i = 0; i < this.config.utilityWorkers; i++) {
            this.createWorker('utility', '/src/workers/utility-worker.js', i);
        }
    }
    
    createWorker(type, scriptPath, index) {
        const worker = new Worker(scriptPath, { type: 'module' });
        const workerId = `${type}-${index}`;
        
        worker.addEventListener('message', (event) => {
            this.handleWorkerMessage(workerId, event.data);
        });
        
        worker.addEventListener('error', (error) => {
            console.error(`Worker ${workerId} error:`, error);
        });
        
        const workerWrapper = {
            id: workerId,
            type,
            index,
            worker,
            busy: false,
            lastTask: null,
            totalTasks: 0,
            totalTime: 0
        };
        
        this.workers[type].push(workerWrapper);
        this.workerStats.set(workerId, {
            tasksCompleted: 0,
            averageTime: 0,
            lastTaskTime: 0
        });
    }
    
    handleWorkerMessage(workerId, data) {
        const { taskId, type, result, error, executionTime } = data;
        
        if (error) {
            console.error(`Worker ${workerId} task ${taskId} error:`, error);
        }
        
        if (this.pendingTasks.has(taskId)) {
            const { resolve, reject, startTime } = this.pendingTasks.get(taskId);
            
            this.pendingTasks.delete(taskId);
            
            // Update worker stats
            const stats = this.workerStats.get(workerId);
            stats.tasksCompleted++;
            stats.lastTaskTime = executionTime || (Date.now() - startTime);
            stats.averageTime = (stats.averageTime * (stats.tasksCompleted - 1) + stats.lastTaskTime) / stats.tasksCompleted;
            
            // Mark worker as available
            const worker = this.findWorkerById(workerId);
            if (worker) {
                worker.busy = false;
                worker.totalTasks++;
                worker.totalTime += stats.lastTaskTime;
            }
            
            if (error) {
                reject(new Error(error));
            } else {
                resolve(result);
            }
            
            // Process next task in queue
            this.processQueue(workerId.split('-')[0]);
        }
    }
    
    findWorkerById(workerId) {
        const [type] = workerId.split('-');
        return this.workers[type].find(w => w.id === workerId);
    }
    
    getAvailableWorker(type) {
        return this.workers[type].find(worker => !worker.busy);
    }
    
    enqueueTask(type, taskData, priority = 0) {
        return new Promise((resolve, reject) => {
            const taskId = this.generateTaskId();
            const task = {
                id: taskId,
                type,
                data: taskData,
                priority,
                resolve,
                reject,
                timestamp: Date.now()
            };
            
            this.pendingTasks.set(taskId, task);
            
            const worker = this.getAvailableWorker(type);
            if (worker) {
                this.executeTask(worker, task);
            } else {
                // Add to queue, sorted by priority
                const queue = this.queues[type];
                queue.push(task);
                queue.sort((a, b) => b.priority - a.priority);
                
                // Prevent memory leaks from excessive queueing
                if (queue.length > this.config.maxQueueSize) {
                    const oldTask = queue.shift();
                    this.pendingTasks.delete(oldTask.id);
                    oldTask.reject(new Error('Task queue overflow'));
                }
            }
        });
    }
    
    executeTask(worker, task) {
        worker.busy = true;
        worker.lastTask = task;
        
        const message = {
            taskId: task.id,
            type: task.data.type,
            ...task.data
        };
        
        worker.worker.postMessage(message);
    }
    
    processQueue(type) {
        const queue = this.queues[type];
        if (queue.length === 0) return;
        
        const worker = this.getAvailableWorker(type);
        if (!worker) return;
        
        const task = queue.shift();
        this.executeTask(worker, task);
    }
    
    generateTaskId() {
        return ++this.taskId;
    }
    
    // High-level API methods
    
    /**
     * Calculate gravity forces for a subset of particles
     */
    async calculateGravity(particleSubset, allParticles, config) {
        return this.enqueueTask('physics', {
            type: 'CALCULATE_GRAVITY',
            particleSubset,
            allParticles,
            config
        }, 10); // High priority
    }
    
    /**
     * Calculate spatial partitioning for particles
     */
    async updateSpatialGrid(particles, gridSize) {
        return this.enqueueTask('physics', {
            type: 'UPDATE_SPATIAL_GRID',
            particles,
            gridSize
        }, 5);
    }
    
    /**
     * Calculate LOD levels for particle chunks
     */
    async calculateLOD(chunks, cameraPosition) {
        return this.enqueueTask('render', {
            type: 'CALCULATE_LOD',
            chunks,
            cameraPosition
        }, 8);
    }
    
    /**
     * Perform frustum culling on chunks
     */
    async frustumCull(chunks, frustumPlanes) {
        return this.enqueueTask('render', {
            type: 'FRUSTUM_CULL',
            chunks,
            frustumPlanes
        }, 9);
    }
    
    /**
     * Sort particles by distance for rendering
     */
    async sortParticles(particles, cameraPosition) {
        return this.enqueueTask('render', {
            type: 'SORT_PARTICLES',
            particles,
            cameraPosition
        }, 6);
    }
    
    /**
     * Generate initial galaxy distribution
     */
    async generateGalaxy(config) {
        return this.enqueueTask('utility', {
            type: 'GENERATE_GALAXY',
            config
        }, 3);
    }
    
    /**
     * Compress/decompress particle data for storage
     */
    async compressData(data) {
        return this.enqueueTask('utility', {
            type: 'COMPRESS_DATA',
            data
        }, 1);
    }
    
    /**
     * Calculate performance statistics
     */
    async calculateStats(particles, renderInfo) {
        return this.enqueueTask('utility', {
            type: 'CALCULATE_STATS',
            particles,
            renderInfo
        }, 2);
    }
    
    // Batch operations for efficiency
    
    /**
     * Process multiple gravity calculations in parallel
     */
    async calculateGravityBatch(particleChunks, allParticles, config) {
        const promises = particleChunks.map(chunk => 
            this.calculateGravity(chunk, allParticles, config)
        );
        
        return Promise.all(promises);
    }
    
    /**
     * Update multiple chunks' LOD in parallel
     */
    async updateLODBatch(chunkBatches, cameraPosition) {
        const promises = chunkBatches.map(batch => 
            this.calculateLOD(batch, cameraPosition)
        );
        
        return Promise.all(promises);
    }
    
    // Advanced scheduling
    
    /**
     * Schedule recurring tasks (e.g., spatial grid updates)
     */
    scheduleRecurringTask(type, taskData, intervalMs, priority = 0) {
        const execute = () => {
            this.enqueueTask(type, taskData, priority)
                .catch(error => console.warn('Recurring task failed:', error))
                .finally(() => {
                    setTimeout(execute, intervalMs);
                });
        };
        
        execute();
    }
    
    /**
     * Prioritize urgent tasks (e.g., when camera moves rapidly)
     */
    prioritizeUrgentTasks() {
        // Boost priority of render-related tasks
        for (const queue of [this.queues.render, this.queues.physics]) {
            queue.forEach(task => {
                if (task.data.type.includes('LOD') || task.data.type.includes('CULL')) {
                    task.priority += 5;
                }
            });
            queue.sort((a, b) => b.priority - a.priority);
        }
    }
    
    // Performance monitoring
    
    getPerformanceStats() {
        const stats = {};
        
        for (const [workerId, workerStats] of this.workerStats.entries()) {
            stats[workerId] = { ...workerStats };
        }
        
        return {
            workers: stats,
            queues: {
                physics: this.queues.physics.length,
                render: this.queues.render.length,
                utility: this.queues.utility.length
            },
            pendingTasks: this.pendingTasks.size
        };
    }
    
    // Cleanup
    
    dispose() {
        // Cancel all pending tasks
        for (const [taskId, task] of this.pendingTasks.entries()) {
            task.reject(new Error('Worker pool disposed'));
        }
        this.pendingTasks.clear();
        
        // Clear queues
        for (const queue of Object.values(this.queues)) {
            queue.length = 0;
        }
        
        // Terminate all workers
        for (const workerArray of Object.values(this.workers)) {
            for (const wrapper of workerArray) {
                wrapper.worker.terminate();
            }
            workerArray.length = 0;
        }
        
        this.workerStats.clear();
    }
}

/**
 * Shared Array Buffer Manager for zero-copy data sharing
 */
export class SharedParticleData {
    constructor(particleCount, useCompression = false) {
        this.particleCount = particleCount;
        this.useCompression = useCompression;
        
        // Check for SharedArrayBuffer support
        this.supportsSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
        
        if (this.supportsSharedArrayBuffer) {
            this.initializeSharedBuffers();
        } else {
            console.warn('SharedArrayBuffer not supported, falling back to regular buffers');
            this.initializeRegularBuffers();
        }
    }
    
    initializeSharedBuffers() {
        // Position data: x, y, z, type (4 floats per particle)
        this.positionBuffer = new SharedArrayBuffer(this.particleCount * 4 * 4);
        this.positions = new Float32Array(this.positionBuffer);
        
        // Velocity data: vx, vy, vz, acceleration (4 floats per particle)
        this.velocityBuffer = new SharedArrayBuffer(this.particleCount * 4 * 4);
        this.velocities = new Float32Array(this.velocityBuffer);
        
        // Render data: visibility, LOD, distance, reserved (4 bytes per particle)
        this.renderBuffer = new SharedArrayBuffer(this.particleCount * 4);
        this.renderData = new Uint8Array(this.renderBuffer);
        
        // Metadata
        this.metadataBuffer = new SharedArrayBuffer(64); // 64 bytes for misc data
        this.metadata = new Int32Array(this.metadataBuffer);
    }
    
    initializeRegularBuffers() {
        this.positions = new Float32Array(this.particleCount * 4);
        this.velocities = new Float32Array(this.particleCount * 4);
        this.renderData = new Uint8Array(this.particleCount * 4);
        this.metadata = new Int32Array(16);
    }
    
    // Transfer data to/from workers
    getTransferableData() {
        if (this.supportsSharedArrayBuffer) {
            return {
                positions: this.positions,
                velocities: this.velocities,
                renderData: this.renderData,
                metadata: this.metadata,
                shared: true
            };
        } else {
            return {
                positions: this.positions.slice(),
                velocities: this.velocities.slice(),
                renderData: this.renderData.slice(),
                metadata: this.metadata.slice(),
                shared: false
            };
        }
    }
    
    updateFromWorkerData(data) {
        if (!this.supportsSharedArrayBuffer) {
            this.positions.set(data.positions);
            this.velocities.set(data.velocities);
            this.renderData.set(data.renderData);
            this.metadata.set(data.metadata);
        }
        // If using SharedArrayBuffer, data is automatically updated
    }
    
    // Utility methods for accessing specific particle data
    getParticlePosition(index) {
        const i = index * 4;
        return {
            x: this.positions[i],
            y: this.positions[i + 1],
            z: this.positions[i + 2],
            type: this.positions[i + 3]
        };
    }
    
    setParticlePosition(index, x, y, z, type = 0) {
        const i = index * 4;
        this.positions[i] = x;
        this.positions[i + 1] = y;
        this.positions[i + 2] = z;
        this.positions[i + 3] = type;
    }
    
    getParticleVelocity(index) {
        const i = index * 4;
        return {
            vx: this.velocities[i],
            vy: this.velocities[i + 1],
            vz: this.velocities[i + 2],
            acceleration: this.velocities[i + 3]
        };
    }
    
    setParticleVelocity(index, vx, vy, vz, acceleration = 0) {
        const i = index * 4;
        this.velocities[i] = vx;
        this.velocities[i + 1] = vy;
        this.velocities[i + 2] = vz;
        this.velocities[i + 3] = acceleration;
    }
}
