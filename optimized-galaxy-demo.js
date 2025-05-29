/**
 * Integration Example for Galaxy Simulation Optimizations
 * Shows how to integrate the new batching and worker systems with existing code
 */

import { GalaxyOptimizationEngine } from './src/GalaxyOptimizationEngine.js';

// Integration wrapper for existing galaxy simulation
class OptimizedGalaxySimulation {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.optimizationEngine = null;
        this.controls = null;
        
        this.isInitialized = false;
        this.animationId = null;
        this.lastTime = 0;
        
        this.ui = {
            stats: null,
            debugPanel: null,
            controls: null
        };
        
        this.init();
    }

    async init() {
        // Initialize Three.js scene
        this.initThreeJS();
        
        // Initialize optimization engine
        await this.initOptimizationEngine();
        
        // Setup UI
        this.setupUI();
        
        // Start animation loop
        this.animate();
        
        this.isInitialized = true;
        console.log('Optimized Galaxy Simulation initialized');
    }

    initThreeJS() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000011);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            1,
            10000
        );
        this.camera.position.set(0, 0, 1000);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: true,
            alpha: true,
            powerPreference: "high-performance"
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        
        // Enable extensions for better performance
        const gl = this.renderer.getContext();
        if (gl.getExtension('ANGLE_instanced_arrays')) {
            console.log('Instanced rendering supported');
        }
        
        document.body.appendChild(this.renderer.domElement);

        // Controls
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxDistance = 5000;
        this.controls.minDistance = 10;

        // Add some ambient lighting
        const ambientLight = new THREE.AmbientLight(0x404040, 0.2);
        this.scene.add(ambientLight);
    }

    async initOptimizationEngine() {
        // Configure optimization engine based on device capabilities
        const config = this.getOptimalConfig();
        
        this.optimizationEngine = new GalaxyOptimizationEngine(
            this.scene,
            this.camera,
            this.renderer,
            config
        );

        console.log('Optimization engine initialized with config:', config);
    }

    getOptimalConfig() {
        // Detect device capabilities and configure accordingly
        const hardwareConcurrency = navigator.hardwareConcurrency || 4;
        const memory = navigator.deviceMemory || 4; // GB
        const gpu = this.detectGPUTier();
        
        let particleCount = 100000;
        let batchSize = 25000;
        let maxDrawCalls = 32;
        let physicsWorkers = Math.min(hardwareConcurrency, 6);
        
        // Adjust based on device capabilities
        if (memory >= 8 && gpu >= 2) {
            // High-end device
            particleCount = 500000;
            batchSize = 50000;
            maxDrawCalls = 64;
        } else if (memory >= 4 && gpu >= 1) {
            // Mid-range device
            particleCount = 250000;
            batchSize = 35000;
            maxDrawCalls = 48;
        } else {
            // Low-end device
            particleCount = 50000;
            batchSize = 15000;
            maxDrawCalls = 16;
            physicsWorkers = Math.min(physicsWorkers, 2);
        }
        
        return {
            particleCount,
            batchSize,
            maxDrawCalls,
            physicsWorkers,
            enableWorkers: true,
            enableBatching: true,
            adaptiveQuality: true,
            enableProfiling: true,
            targetFPS: 60,
            simulationSpeed: 1.0
        };
    }

    detectGPUTier() {
        // Simple GPU capability detection
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        
        if (!gl) return 0;
        
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
            const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
            
            // Basic GPU tier detection
            if (renderer.includes('RTX') || renderer.includes('RX')) return 3;
            if (renderer.includes('GTX') || renderer.includes('Radeon')) return 2;
            if (renderer.includes('Intel') || renderer.includes('integrated')) return 0;
            return 1;
        }
        
        return 1; // Default tier
    }

    setupUI() {
        // Create stats display
        this.createStatsDisplay();
        
        // Create debug panel
        this.createDebugPanel();
        
        // Create control panel
        this.createControlPanel();
        
        // Setup keyboard shortcuts
        this.setupKeyboardShortcuts();
    }

    createStatsDisplay() {
        const statsContainer = document.createElement('div');
        statsContainer.id = 'stats-container';
        statsContainer.style.cssText = `
            position: fixed;
            top: 10px;
            left: 10px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px;
            border-radius: 5px;
            font-family: monospace;
            font-size: 12px;
            z-index: 1000;
        `;
        
        document.body.appendChild(statsContainer);
        this.ui.stats = statsContainer;
    }

    createDebugPanel() {
        const debugPanel = document.createElement('div');
        debugPanel.id = 'debug-panel';
        debugPanel.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px;
            border-radius: 5px;
            font-family: monospace;
            font-size: 11px;
            max-width: 300px;
            z-index: 1000;
            display: none;
        `;
        
        document.body.appendChild(debugPanel);
        this.ui.debugPanel = debugPanel;
    }

    createControlPanel() {
        const controlPanel = document.createElement('div');
        controlPanel.id = 'control-panel';
        controlPanel.style.cssText = `
            position: fixed;
            bottom: 10px;
            left: 10px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px;
            border-radius: 5px;
            font-family: monospace;
            font-size: 12px;
            z-index: 1000;
        `;
        
        const controls = `
            <div>Controls:</div>
            <div>D - Toggle Debug Info</div>
            <div>P - Pause/Resume Physics</div>
            <div>R - Reset Simulation</div>
            <div>+/- - Adjust Simulation Speed</div>
            <div>Mouse - Orbit Camera</div>
        `;
        
        controlPanel.innerHTML = controls;
        document.body.appendChild(controlPanel);
        this.ui.controls = controlPanel;
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (event) => {
            switch (event.key.toLowerCase()) {
                case 'd':
                    this.toggleDebugInfo();
                    break;
                case 'p':
                    this.togglePhysics();
                    break;
                case 'r':
                    this.resetSimulation();
                    break;
                case '+':
                case '=':
                    this.adjustSimulationSpeed(1.2);
                    break;
                case '-':
                    this.adjustSimulationSpeed(0.8);
                    break;
            }
        });
    }

    toggleDebugInfo() {
        const panel = this.ui.debugPanel;
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }

    togglePhysics() {
        if (this.optimizationEngine) {
            this.optimizationEngine.config.enablePhysics = !this.optimizationEngine.config.enablePhysics;
            console.log('Physics:', this.optimizationEngine.config.enablePhysics ? 'enabled' : 'disabled');
        }
    }

    async resetSimulation() {
        if (this.optimizationEngine) {
            console.log('Resetting simulation...');
            await this.optimizationEngine.generateGalaxy();
        }
    }

    adjustSimulationSpeed(factor) {
        if (this.optimizationEngine) {
            this.optimizationEngine.config.simulationSpeed *= factor;
            this.optimizationEngine.config.simulationSpeed = Math.max(0.1, Math.min(5.0, this.optimizationEngine.config.simulationSpeed));
            console.log('Simulation speed:', this.optimizationEngine.config.simulationSpeed.toFixed(2));
        }
    }

    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());
        
        const currentTime = performance.now();
        const deltaTime = (currentTime - this.lastTime) / 1000;
        this.lastTime = currentTime;
        
        // Update controls
        if (this.controls) {
            this.controls.update();
        }
        
        // Update optimization engine
        if (this.optimizationEngine) {
            this.optimizationEngine.update(deltaTime);
        }
        
        // Update UI
        this.updateUI();
        
        // Note: The optimization engine handles its own rendering
        // so we don't call renderer.render() here
    }

    updateUI() {
        if (!this.optimizationEngine) return;
        
        // Update stats display
        const stats = this.optimizationEngine.getPerformanceStats();
        if (this.ui.stats) {
            this.ui.stats.innerHTML = `
                FPS: ${stats.fps.toFixed(1)}<br>
                Frame Time: ${stats.frameTime.toFixed(2)}ms<br>
                Draw Calls: ${stats.drawCalls}<br>
                Visible Particles: ${stats.visibleParticles.toLocaleString()}<br>
                Total Particles: ${stats.totalParticles.toLocaleString()}
            `;
        }
        
        // Update debug panel
        if (this.ui.debugPanel && this.ui.debugPanel.style.display !== 'none') {
            const debugInfo = this.optimizationEngine.getDebugInfo();
            this.ui.debugPanel.innerHTML = `
                <strong>Debug Information</strong><br>
                <br>
                <strong>Configuration:</strong><br>
                Batch Size: ${debugInfo.config.batchSize.toLocaleString()}<br>
                Max Draw Calls: ${debugInfo.config.maxDrawCalls}<br>
                Physics Workers: ${debugInfo.config.physicsWorkers}<br>
                Adaptive Quality: ${debugInfo.config.adaptiveQuality}<br>
                <br>
                <strong>Memory Usage:</strong><br>
                Estimated: ${debugInfo.memoryUsage.estimated}<br>
                <br>
                <strong>Batching:</strong><br>
                ${debugInfo.performance.batching ? `
                    Total Batches: ${debugInfo.performance.batching.totalBatches}<br>
                    Material Types: ${debugInfo.performance.batching.materialTypes}
                ` : 'Not available'}
            `;
        }
    }

    dispose() {
        // Stop animation loop
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        
        // Dispose optimization engine
        if (this.optimizationEngine) {
            this.optimizationEngine.dispose();
        }
        
        // Dispose Three.js resources
        if (this.renderer) {
            this.renderer.dispose();
        }
        
        // Remove UI elements
        Object.values(this.ui).forEach(element => {
            if (element && element.parentNode) {
                element.parentNode.removeChild(element);
            }
        });
    }
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new OptimizedGalaxySimulation();
    });
} else {
    new OptimizedGalaxySimulation();
}

// Export for use in other contexts
export { OptimizedGalaxySimulation };
