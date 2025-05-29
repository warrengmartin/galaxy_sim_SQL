/**
 * Advanced Particle Batch Manager for Galaxy Simulation
 * Implements spatial partitioning and LOD-based batching for optimal rendering performance
 */

export class ParticleBatchManager {
    constructor(particleSystem, config = {}) {
        this.particleSystem = particleSystem;
        this.config = {
            chunkSize: config.chunkSize || 10000,
            spatialGridSize: config.spatialGridSize || 200,
            maxLODLevels: config.maxLODLevels || 3,
            cullDistance: config.cullDistance || 5000,
            ...config
        };
        
        this.chunks = [];
        this.spatialGrid = new Map();
        this.visibleChunks = new Set();
        this.frustum = new THREE.Frustum();
        this.matrix = new THREE.Matrix4();
        
        this.lodRanges = [
            { max: 1000, density: 1.0, pointSize: 2.0 },    // High detail
            { max: 3000, density: 0.6, pointSize: 1.5 },    // Medium detail  
            { max: 8000, density: 0.3, pointSize: 1.0 },    // Low detail
            { max: Infinity, density: 0.1, pointSize: 0.5 }  // Very low detail
        ];
        
        this.initializeBatches();
    }
    
    initializeBatches() {
        const totalParticles = this.particleSystem.particleCount;
        const chunksCount = Math.ceil(totalParticles / this.config.chunkSize);
        
        // Create spatial chunks
        for (let i = 0; i < chunksCount; i++) {
            const startIdx = i * this.config.chunkSize;
            const endIdx = Math.min(startIdx + this.config.chunkSize, totalParticles);
            
            const chunk = {
                id: i,
                startIndex: startIdx,
                endIndex: endIdx,
                particleCount: endIdx - startIdx,
                boundingBox: new THREE.Box3(),
                boundingSphere: new THREE.Sphere(),
                centroid: new THREE.Vector3(),
                visible: false,
                lodLevel: 0,
                lastUpdateFrame: 0,
                
                // Rendering resources
                geometry: null,
                material: null,
                mesh: null,
                
                // Performance tracking
                renderTime: 0,
                triangles: 0
            };
            
            this.chunks.push(chunk);
        }
        
        // Initialize spatial grid
        this.buildSpatialGrid();
        this.createChunkGeometries();
    }
    
    buildSpatialGrid() {
        const gridSize = this.config.spatialGridSize;
        this.spatialGrid.clear();
        
        for (const chunk of this.chunks) {
            this.updateChunkBounds(chunk);
            
            // Calculate grid cell for chunk centroid
            const cellX = Math.floor(chunk.centroid.x / gridSize);
            const cellY = Math.floor(chunk.centroid.y / gridSize);
            const cellZ = Math.floor(chunk.centroid.z / gridSize);
            const cellKey = `${cellX},${cellY},${cellZ}`;
            
            if (!this.spatialGrid.has(cellKey)) {
                this.spatialGrid.set(cellKey, []);
            }
            this.spatialGrid.get(cellKey).push(chunk);
        }
    }
    
    updateChunkBounds(chunk) {
        const positions = this.particleSystem.getPositionData();
        chunk.boundingBox.makeEmpty();
        
        let totalX = 0, totalY = 0, totalZ = 0;
        
        for (let i = chunk.startIndex; i < chunk.endIndex; i++) {
            const x = positions[i * 3];
            const y = positions[i * 3 + 1];
            const z = positions[i * 3 + 2];
            
            chunk.boundingBox.expandByPoint(new THREE.Vector3(x, y, z));
            totalX += x;
            totalY += y;
            totalZ += z;
        }
        
        // Calculate centroid
        const count = chunk.particleCount;
        chunk.centroid.set(totalX / count, totalY / count, totalZ / count);
        
        // Calculate bounding sphere
        chunk.boundingBox.getBoundingSphere(chunk.boundingSphere);
    }
    
    createChunkGeometries() {
        for (const chunk of this.chunks) {
            // Create geometry for this chunk
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(chunk.particleCount * 3);
            const uvs = new Float32Array(chunk.particleCount * 2);
            const indices = new Float32Array(chunk.particleCount);
            
            // Fill geometry data
            for (let i = 0; i < chunk.particleCount; i++) {
                const globalIdx = chunk.startIndex + i;
                indices[i] = globalIdx;
                
                // UV coordinates for texture lookup
                const textureSize = Math.sqrt(this.particleSystem.totalParticles);
                uvs[i * 2] = (globalIdx % textureSize) / textureSize;
                uvs[i * 2 + 1] = Math.floor(globalIdx / textureSize) / textureSize;
            }
            
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
            geometry.setAttribute('particleIndex', new THREE.BufferAttribute(indices, 1));
            
            chunk.geometry = geometry;
            
            // Create material (shared or per-chunk based on LOD)
            chunk.material = this.createChunkMaterial(chunk);
            
            // Create mesh
            chunk.mesh = new THREE.Points(geometry, chunk.material);
            chunk.mesh.frustumCulled = false; // We handle culling manually
            chunk.mesh.userData.chunkId = chunk.id;
        }
    }
    
    createChunkMaterial(chunk) {
        const vertexShader = `
            uniform sampler2D texturePosition;
            uniform sampler2D textureVelocity;
            uniform float cameraConstant;
            uniform float lodLevel;
            uniform float pointSizeMultiplier;
            
            attribute float particleIndex;
            varying vec4 vColor;
            varying float vLodAlpha;
            
            void main() {
                vec4 posTemp = texture2D(texturePosition, uv);
                vec3 pos = posTemp.xyz;
                
                vec4 velTemp = texture2D(textureVelocity, uv);
                float acc = velTemp.w;
                
                vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                
                // LOD-based point size
                float baseSize = pointSizeMultiplier;
                float distanceScale = cameraConstant / (-mvPosition.z);
                gl_PointSize = baseSize * distanceScale;
                
                // LOD fade based on distance
                float distance = length(mvPosition);
                vLodAlpha = smoothstep(8000.0, 5000.0, distance);
                
                gl_Position = projectionMatrix * mvPosition;
                
                // Color based on acceleration (from existing system)
                vec3 lowAccelColor = vec3(0.012, 0.063, 0.988);
                vec3 highAccelColor = vec3(1.0, 0.376, 0.188);
                vec3 finalColor = mix(lowAccelColor, highAccelColor, clamp(acc / 2.0, 0.0, 1.0));
                
                vColor = vec4(finalColor, 0.8 * vLodAlpha);
            }
        `;
        
        const fragmentShader = `
            varying vec4 vColor;
            varying float vLodAlpha;
            
            void main() {
                // Circular point sprite
                vec2 center = gl_PointCoord - vec2(0.5);
                float dist = length(center);
                
                if (dist > 0.5) discard;
                
                float alpha = (1.0 - dist * 2.0) * vColor.a;
                gl_FragColor = vec4(vColor.rgb, alpha);
            }
        `;
        
        return new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                texturePosition: { value: null },
                textureVelocity: { value: null },
                cameraConstant: { value: 1000 },
                lodLevel: { value: 0 },
                pointSizeMultiplier: { value: 1.0 }
            },
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
    }
    
    updateVisibility(camera, frameNumber) {
        // Update frustum
        this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.matrix);
        
        const cameraPosition = camera.position;
        this.visibleChunks.clear();
        
        for (const chunk of this.chunks) {
            const distance = cameraPosition.distanceTo(chunk.centroid);
            
            // Distance culling
            if (distance > this.config.cullDistance) {
                chunk.visible = false;
                continue;
            }
            
            // Frustum culling
            if (!this.frustum.intersectsSphere(chunk.boundingSphere)) {
                chunk.visible = false;
                continue;
            }
            
            // Update LOD level based on distance
            chunk.lodLevel = this.calculateLODLevel(distance);
            chunk.visible = true;
            chunk.lastUpdateFrame = frameNumber;
            
            this.visibleChunks.add(chunk);
            
            // Update material uniforms
            if (chunk.material) {
                const lodConfig = this.lodRanges[chunk.lodLevel];
                chunk.material.uniforms.lodLevel.value = chunk.lodLevel;
                chunk.material.uniforms.pointSizeMultiplier.value = lodConfig.pointSize;
            }
        }
        
        return this.visibleChunks.size;
    }
    
    calculateLODLevel(distance) {
        for (let i = 0; i < this.lodRanges.length; i++) {
            if (distance <= this.lodRanges[i].max) {
                return i;
            }
        }
        return this.lodRanges.length - 1;
    }
    
    render(scene, camera, renderer) {
        // Sort visible chunks by distance for proper alpha blending
        const sortedChunks = Array.from(this.visibleChunks).sort((a, b) => {
            const distA = camera.position.distanceTo(a.centroid);
            const distB = camera.position.distanceTo(b.centroid);
            return distB - distA; // Far to near for additive blending
        });
        
        // Batch render by material/LOD level
        const batches = new Map();
        
        for (const chunk of sortedChunks) {
            const lodLevel = chunk.lodLevel;
            if (!batches.has(lodLevel)) {
                batches.set(lodLevel, []);
            }
            batches.get(lodLevel).push(chunk);
        }
        
        // Render each LOD batch
        let totalDrawCalls = 0;
        let totalTriangles = 0;
        
        for (const [lodLevel, chunks] of batches.entries()) {
            const lodConfig = this.lodRanges[lodLevel];
            
            // Skip very low detail chunks if too many
            if (lodLevel >= 3 && chunks.length > 50) {
                continue;
            }
            
            for (const chunk of chunks) {
                if (!chunk.mesh) continue;
                
                // Update uniforms
                chunk.material.uniforms.texturePosition.value = 
                    this.particleSystem.gpuCompute.getCurrentRenderTarget(this.particleSystem.positionVariable).texture;
                chunk.material.uniforms.textureVelocity.value = 
                    this.particleSystem.gpuCompute.getCurrentRenderTarget(this.particleSystem.velocityVariable).texture;
                chunk.material.uniforms.cameraConstant.value = this.getCameraConstant(camera);
                
                // Add to scene if not already added
                if (!chunk.mesh.parent) {
                    scene.add(chunk.mesh);
                }
                
                totalDrawCalls++;
                totalTriangles += chunk.particleCount;
            }
        }
        
        // Remove invisible chunks from scene
        for (const chunk of this.chunks) {
            if (!chunk.visible && chunk.mesh && chunk.mesh.parent) {
                scene.remove(chunk.mesh);
            }
        }
        
        return {
            visibleChunks: this.visibleChunks.size,
            drawCalls: totalDrawCalls,
            particles: totalTriangles
        };
    }
    
    getCameraConstant(camera) {
        return window.innerHeight / (Math.tan(THREE.MathUtils.DEG2RAD * 0.5 * camera.fov) / camera.zoom);
    }
    
    // Memory management
    dispose() {
        for (const chunk of this.chunks) {
            if (chunk.geometry) chunk.geometry.dispose();
            if (chunk.material) chunk.material.dispose();
            if (chunk.mesh && chunk.mesh.parent) {
                chunk.mesh.parent.remove(chunk.mesh);
            }
        }
        
        this.chunks.length = 0;
        this.spatialGrid.clear();
        this.visibleChunks.clear();
    }
    
    // Debug visualization
    visualizeBounds(scene) {
        const material = new THREE.LineBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.3 });
        
        for (const chunk of this.chunks) {
            if (!chunk.visible) continue;
            
            const box = new THREE.Box3Helper(chunk.boundingBox, 0x00ff00);
            scene.add(box);
        }
    }
}
