/**
 * Galaxy Simulation Mode Manager
 * Handles switching between different simulation backends:
 * - GPU Compute (existing Three.js based)
 * - Rust WASM (new high-performance backend)
 * - Replay Mode (existing)
 */

import { rustSimulation, PerformanceComparison } from './RustGalaxySimulation.js';

export class SimulationModeManager {
    constructor() {
        this.currentMode = 'GPU'; // 'GPU', 'RUST', 'REPLAY'
        this.isInitialized = false;
        
        // References to existing global variables (will be passed in)
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.geometry = null;
        this.material = null;
        this.effectController = null;
        
        // Performance tracking
        this.performanceStats = {
            fps: 0,
            frameTime: 0,
            particleCount: 0,
            mode: 'GPU'
        };
        
        this.lastFrameTime = 0;
        this.frameCount = 0;
        
        console.log('🎛️ SimulationModeManager created');
    }

    /**
     * Initialize the mode manager with Three.js references
     */
    initialize(refs) {
        this.scene = refs.scene;
        this.camera = refs.camera;
        this.renderer = refs.renderer;
        this.geometry = refs.geometry;
        this.material = refs.material;
        this.effectController = refs.effectController;
        
        this.isInitialized = true;
        console.log('✅ SimulationModeManager initialized');
    }

    /**
     * Switch to Rust-based simulation
     */
    async switchToRustMode(particleCount = null) {
        if (!this.isInitialized) {
            console.error('❌ SimulationModeManager not initialized');
            return false;
        }

        try {
            console.log('🦀 Switching to Rust simulation mode...');
            
            // Use current particle count if not specified
            const particles = particleCount || this.effectController?.numberOfStars || 10000;
            
            // Initialize Rust simulation
            const success = await rustSimulation.initialize(particles);
            if (!success) {
                console.error('❌ Failed to initialize Rust simulation');
                return false;
            }

            // Update geometry to work with Rust simulation
            this.setupRustGeometry(particles);
            
            // Update material uniforms for compatibility
            this.updateMaterialForRust();
            
            this.currentMode = 'RUST';
            this.performanceStats.mode = 'RUST';
            this.performanceStats.particleCount = particles;
            
            console.log(`✅ Switched to Rust mode with ${particles} particles`);
            return true;
            
        } catch (error) {
            console.error('❌ Error switching to Rust mode:', error);
            return false;
        }
    }

    /**
     * Switch back to GPU compute mode
     */
    switchToGPUMode() {
        if (this.currentMode === 'RUST') {
            rustSimulation.destroy();
        }
        
        this.currentMode = 'GPU';
        this.performanceStats.mode = 'GPU';
        
        console.log('🖥️ Switched to GPU compute mode');
        return true;
    }

    /**
     * Switch to replay mode
     */
    switchToReplayMode() {
        if (this.currentMode === 'RUST') {
            rustSimulation.stop();
        }
        
        this.currentMode = 'REPLAY';
        this.performanceStats.mode = 'REPLAY';
        
        console.log('📹 Switched to replay mode');
        return true;
    }

    /**
     * Setup geometry for Rust simulation
     */
    setupRustGeometry(particleCount) {
        if (!this.geometry) {
            console.error('❌ No geometry reference available');
            return;
        }

        // Create or update position attribute
        const positions = new Float32Array(particleCount * 3);
        
        // If geometry already has positions, preserve the buffer
        if (this.geometry.getAttribute('position')) {
            this.geometry.getAttribute('position').array = positions;
            this.geometry.getAttribute('position').count = particleCount;
        } else {
            this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        }

        // Update geometry
        this.geometry.getAttribute('position').needsUpdate = true;
        this.geometry.computeBoundingSphere();
        
        console.log(`🔗 Geometry updated for ${particleCount} particles`);
    }

    /**
     * Update material uniforms for Rust compatibility
     */
    updateMaterialForRust() {
        if (!this.material) return;

        // Disable GPU compute-specific uniforms
        if (this.material.uniforms.texturePosition) {
            this.material.uniforms.texturePosition.value = null;
        }
        if (this.material.uniforms.textureVelocity) {
            this.material.uniforms.textureVelocity.value = null;
        }

        // Use standard Three.js rendering pipeline
        this.material.needsUpdate = true;
    }

    /**
     * Update simulation (called every frame)
     */
    update(deltaTime) {
        if (!this.isInitialized) return;

        this.updatePerformanceStats(deltaTime);

        switch (this.currentMode) {
            case 'RUST':
                return this.updateRustSimulation(deltaTime);
            case 'GPU':
                return this.updateGPUSimulation(deltaTime);
            case 'REPLAY':
                return this.updateReplayMode(deltaTime);
            default:
                return false;
        }
    }

    /**
     * Update Rust simulation
     */
    updateRustSimulation(deltaTime) {
        if (!rustSimulation.isInitialized) return false;

        // Step Rust simulation
        const success = rustSimulation.step(deltaTime);
        if (!success) return false;

        // Update Three.js geometry with new positions
        if (this.geometry) {
            const updated = rustSimulation.updateThreeGeometry(this.geometry);
            if (updated) {
                this.geometry.computeBoundingSphere();
            }
            return updated;
        }

        return false;
    }

    /**
     * Update GPU simulation (existing behavior)
     */
    updateGPUSimulation(deltaTime) {
        // This would call the existing GPU compute update
        // The actual implementation depends on the existing code structure
        return true;
    }

    /**
     * Update replay mode (existing behavior)
     */
    updateReplayMode(deltaTime) {
        // This would handle replay updates
        // The actual implementation depends on the existing code structure
        return true;
    }

    /**
     * Start simulation
     */
    start() {
        switch (this.currentMode) {
            case 'RUST':
                rustSimulation.start();
                break;
            case 'GPU':
                // Existing GPU start logic
                break;
            case 'REPLAY':
                // Existing replay start logic
                break;
        }
        
        console.log(`▶️ Started ${this.currentMode} simulation`);
    }

    /**
     * Stop simulation
     */
    stop() {
        switch (this.currentMode) {
            case 'RUST':
                rustSimulation.stop();
                break;
            case 'GPU':
                // Existing GPU stop logic
                break;
            case 'REPLAY':
                // Existing replay stop logic
                break;
        }
        
        console.log(`⏸️ Stopped ${this.currentMode} simulation`);
    }

    /**
     * Reset simulation
     */
    reset() {
        switch (this.currentMode) {
            case 'RUST':
                return rustSimulation.reset();
            case 'GPU':
                // Existing GPU reset logic
                return true;
            case 'REPLAY':
                // Existing replay reset logic
                return true;
        }
    }

    /**
     * Update performance statistics
     */
    updatePerformanceStats(deltaTime) {
        this.frameCount++;
        this.performanceStats.frameTime = deltaTime * 1000; // Convert to ms
        
        // Update FPS every 60 frames
        if (this.frameCount % 60 === 0) {
            const currentTime = performance.now();
            if (this.lastFrameTime > 0) {
                const elapsed = currentTime - this.lastFrameTime;
                this.performanceStats.fps = Math.round(60000 / elapsed);
            }
            this.lastFrameTime = currentTime;
        }

        // Update particle count
        switch (this.currentMode) {
            case 'RUST':
                this.performanceStats.particleCount = rustSimulation.getParticleCount();
                break;
            case 'GPU':
                this.performanceStats.particleCount = this.effectController?.numberOfStars || 0;
                break;
        }
    }

    /**
     * Get current performance statistics
     */
    getPerformanceStats() {
        if (this.currentMode === 'RUST') {
            const rustStats = rustSimulation.getPerformanceStats();
            return {
                ...this.performanceStats,
                ...rustStats
            };
        }
        
        return this.performanceStats;
    }

    /**
     * Run performance benchmark comparing all modes
     */
    async runBenchmark(particleCount = 1000, steps = 100) {
        console.log('🏁 Starting comprehensive performance benchmark...');
        
        const results = {};
        
        // Benchmark Rust mode
        try {
            const rustResults = await PerformanceComparison.benchmarkComparison(particleCount, steps);
            results.rust = rustResults;
        } catch (error) {
            console.error('❌ Rust benchmark failed:', error);
            results.rust = { error: error.message };
        }
        
        // TODO: Add GPU mode benchmark when available
        // TODO: Add replay mode benchmark when available
        
        console.log('📊 Benchmark results:', results);
        return results;
    }

    /**
     * Get current mode
     */
    getCurrentMode() {
        return this.currentMode;
    }

    /**
     * Check if current mode supports real-time simulation
     */
    supportsRealTime() {
        return this.currentMode === 'RUST' || this.currentMode === 'GPU';
    }

    /**
     * Check if current mode supports recording
     */
    supportsRecording() {
        return this.currentMode === 'RUST' || this.currentMode === 'GPU';
    }

    /**
     * Save current frame (if supported)
     */
    saveFrame(filename) {
        if (this.currentMode === 'RUST') {
            return rustSimulation.saveFrame(filename);
        }
        
        console.warn(`⚠️ Frame saving not supported in ${this.currentMode} mode`);
        return false;
    }

    /**
     * Cleanup resources
     */
    destroy() {
        if (this.currentMode === 'RUST') {
            rustSimulation.destroy();
        }
        
        this.isInitialized = false;
        console.log('🗑️ SimulationModeManager destroyed');
    }
}

// Export singleton instance
export const simulationManager = new SimulationModeManager();

// Export convenience functions for easy integration
export const SimulationAPI = {
    /**
     * Initialize and switch to high-performance Rust mode
     */
    async enableRustMode(particleCount) {
        return await simulationManager.switchToRustMode(particleCount);
    },

    /**
     * Switch back to GPU compute mode
     */
    enableGPUMode() {
        return simulationManager.switchToGPUMode();
    },

    /**
     * Get current performance stats
     */
    getStats() {
        return simulationManager.getPerformanceStats();
    },

    /**
     * Run performance comparison
     */
    async benchmark(particleCount = 1000) {
        return await simulationManager.runBenchmark(particleCount, 100);
    }
};
