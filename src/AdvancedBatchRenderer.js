/**
 * Advanced Batching Renderer for Galaxy Simulation
 * Implements multi-level batching strategies for optimal performance
 */

export class AdvancedBatchRenderer {
    constructor(scene, camera, renderer, config = {}) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        
        this.config = {
            maxBatchSize: config.maxBatchSize || 50000,
            instancedBatchSize: config.instancedBatchSize || 10000,
            materialBatches: config.materialBatches || 4,
            useGeometryInstancing: config.useGeometryInstancing !== false,
            useDrawRanges: config.useDrawRanges !== false,
            enableDepthSorting: config.enableDepthSorting !== false,
            maxDrawCalls: config.maxDrawCalls || 32,
            ...config
        };

        this.batches = new Map();
        this.instancedBatches = new Map();
        this.materialGroups = new Map();
        this.sortedIndices = [];
        this.drawCallCounter = 0;
        
        this.initializeMaterials();
        this.initializeBatchGeometries();
    }

    initializeMaterials() {
        // Create material variants for different particle types
        this.materials = new Map();
        
        // Young stars (blue-white)
        this.materials.set('young', new THREE.ShaderMaterial({
            uniforms: {
                pointSize: { value: 2.0 },
                opacity: { value: 0.8 },
                color: { value: new THREE.Color(0.7, 0.9, 1.0) },
                time: { value: 0 }
            },
            vertexShader: `
                uniform float pointSize;
                uniform float time;
                attribute float particleType;
                attribute float particleMass;
                varying float vType;
                varying float vMass;
                
                void main() {
                    vType = particleType;
                    vMass = particleMass;
                    
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    
                    // Size based on distance and mass
                    float distance = length(mvPosition.xyz);
                    float sizeFactor = pointSize * particleMass * (300.0 / distance);
                    gl_PointSize = clamp(sizeFactor, 0.5, 8.0);
                }
            `,
            fragmentShader: `
                uniform vec3 color;
                uniform float opacity;
                varying float vType;
                varying float vMass;
                
                void main() {
                    float distanceFromCenter = length(gl_PointCoord - 0.5);
                    if (distanceFromCenter > 0.5) discard;
                    
                    // Soft edges
                    float alpha = smoothstep(0.5, 0.3, distanceFromCenter);
                    
                    // Brightness based on mass
                    vec3 finalColor = color * (0.5 + vMass * 0.5);
                    
                    gl_FragColor = vec4(finalColor, alpha * opacity);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        }));

        // Middle-age stars (yellow-white)
        this.materials.set('middle', new THREE.ShaderMaterial({
            uniforms: {
                pointSize: { value: 1.8 },
                opacity: { value: 0.7 },
                color: { value: new THREE.Color(1.0, 0.9, 0.7) },
                time: { value: 0 }
            },
            vertexShader: this.materials.get('young').vertexShader,
            fragmentShader: this.materials.get('young').fragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        }));

        // Old stars (red-orange)
        this.materials.set('old', new THREE.ShaderMaterial({
            uniforms: {
                pointSize: { value: 1.5 },
                opacity: { value: 0.6 },
                color: { value: new THREE.Color(1.0, 0.6, 0.3) },
                time: { value: 0 }
            },
            vertexShader: this.materials.get('young').vertexShader,
            fragmentShader: this.materials.get('young').fragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        }));

        // Gas/dark matter (faint purple)
        this.materials.set('gas', new THREE.ShaderMaterial({
            uniforms: {
                pointSize: { value: 1.0 },
                opacity: { value: 0.3 },
                color: { value: new THREE.Color(0.8, 0.5, 1.0) },
                time: { value: 0 }
            },
            vertexShader: this.materials.get('young').vertexShader,
            fragmentShader: this.materials.get('young').fragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        }));
    }

    initializeBatchGeometries() {
        this.batchGeometries = new Map();
        
        for (const [type, material] of this.materials) {
            // Create geometry for this material type
            const geometry = new THREE.BufferGeometry();
            
            // Initialize empty buffers
            const positions = new Float32Array(this.config.maxBatchSize * 3);
            const types = new Float32Array(this.config.maxBatchSize);
            const masses = new Float32Array(this.config.maxBatchSize);
            
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('particleType', new THREE.BufferAttribute(types, 1));
            geometry.setAttribute('particleMass', new THREE.BufferAttribute(masses, 1));
            
            geometry.setDrawRange(0, 0); // Start with no particles
            
            this.batchGeometries.set(type, geometry);
        }
    }

    /**
     * Update batches with new particle data
     */
    updateBatches(particleData, visibleIndices) {
        const { positions, types, masses, velocities } = particleData;
        
        // Clear existing batches
        this.clearBatches();
        
        // Group particles by type
        const typeGroups = this.groupParticlesByType(visibleIndices, types);
        
        // Create batches for each type
        for (const [type, indices] of typeGroups) {
            this.createBatchesForType(type, indices, positions, types, masses);
        }
        
        // Sort batches by depth if enabled
        if (this.config.enableDepthSorting) {
            this.sortBatchesByDepth();
        }
    }

    groupParticlesByType(visibleIndices, types) {
        const typeGroups = new Map();
        const typeNames = ['young', 'middle', 'old', 'gas'];
        
        for (const typeIndex of [0, 1, 2, 3]) {
            typeGroups.set(typeNames[typeIndex], []);
        }
        
        for (const particleIndex of visibleIndices) {
            const typeIndex = Math.floor(types[particleIndex]);
            const typeName = typeNames[typeIndex] || 'gas';
            typeGroups.get(typeName).push(particleIndex);
        }
        
        return typeGroups;
    }

    createBatchesForType(type, indices, positions, types, masses) {
        const geometry = this.batchGeometries.get(type);
        const material = this.materials.get(type);
        
        if (!geometry || !material) return;
        
        const batchSize = this.config.maxBatchSize;
        const batches = [];
        
        for (let i = 0; i < indices.length; i += batchSize) {
            const batchIndices = indices.slice(i, i + batchSize);
            const batch = this.createBatch(type, batchIndices, positions, types, masses);
            if (batch) {
                batches.push(batch);
            }
        }
        
        this.batches.set(type, batches);
    }

    createBatch(type, indices, positions, types, masses) {
        const geometry = this.batchGeometries.get(type).clone();
        const material = this.materials.get(type);
        
        const batchPositions = geometry.attributes.position.array;
        const batchTypes = geometry.attributes.particleType.array;
        const batchMasses = geometry.attributes.particleMass.array;
        
        // Copy particle data to batch buffers
        for (let i = 0; i < indices.length; i++) {
            const particleIndex = indices[i];
            
            batchPositions[i * 3] = positions[particleIndex * 3];
            batchPositions[i * 3 + 1] = positions[particleIndex * 3 + 1];
            batchPositions[i * 3 + 2] = positions[particleIndex * 3 + 2];
            
            batchTypes[i] = types[particleIndex];
            batchMasses[i] = masses[particleIndex];
        }
        
        // Update buffer attributes
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.particleType.needsUpdate = true;
        geometry.attributes.particleMass.needsUpdate = true;
        
        // Set draw range
        geometry.setDrawRange(0, indices.length);
        
        // Create points object
        const points = new THREE.Points(geometry, material);
        
        // Calculate batch center for depth sorting
        const center = this.calculateBatchCenter(indices, positions);
        points.userData.center = center;
        points.userData.depth = this.calculateDepthFromCamera(center);
        
        return points;
    }

    calculateBatchCenter(indices, positions) {
        const center = new THREE.Vector3();
        
        for (const index of indices) {
            center.x += positions[index * 3];
            center.y += positions[index * 3 + 1];
            center.z += positions[index * 3 + 2];
        }
        
        center.divideScalar(indices.length);
        return center;
    }

    calculateDepthFromCamera(center) {
        const cameraPosition = this.camera.position;
        const distance = center.distanceTo(cameraPosition);
        
        // Transform to camera space for proper depth
        const viewMatrix = this.camera.matrixWorldInverse;
        const centerView = center.clone().applyMatrix4(viewMatrix);
        
        return centerView.z;
    }

    sortBatchesByDepth() {
        for (const [type, batches] of this.batches) {
            batches.sort((a, b) => {
                // Sort back to front for transparency
                return b.userData.depth - a.userData.depth;
            });
        }
    }

    /**
     * Render all batches with optimized draw calls
     */
    render() {
        this.drawCallCounter = 0;
        
        // Render opaque materials first, then transparent
        const renderOrder = ['old', 'middle', 'young', 'gas'];
        
        for (const type of renderOrder) {
            const batches = this.batches.get(type);
            if (!batches) continue;
            
            for (const batch of batches) {
                if (this.drawCallCounter >= this.config.maxDrawCalls) {
                    console.warn('Maximum draw calls reached, skipping remaining batches');
                    break;
                }
                
                this.renderBatch(batch);
                this.drawCallCounter++;
            }
        }
        
        return this.drawCallCounter;
    }

    renderBatch(batch) {
        // Add to scene temporarily for rendering
        this.scene.add(batch);
        
        // Render just this batch
        this.renderer.render(this.scene, this.camera);
        
        // Remove from scene
        this.scene.remove(batch);
    }

    /**
     * Alternative rendering using instanced geometries
     */
    renderInstanced(particleData, visibleIndices) {
        this.clearInstancedBatches();
        
        const { positions, types, masses } = particleData;
        const typeGroups = this.groupParticlesByType(visibleIndices, types);
        
        for (const [type, indices] of typeGroups) {
            if (indices.length === 0) continue;
            
            const instancedMesh = this.createInstancedBatch(type, indices, positions, masses);
            if (instancedMesh) {
                this.scene.add(instancedMesh);
                this.instancedBatches.set(type, instancedMesh);
            }
        }
    }

    createInstancedBatch(type, indices, positions, masses) {
        const material = this.materials.get(type);
        if (!material) return null;
        
        // Use simple geometry for instancing
        const geometry = new THREE.PlaneGeometry(1, 1);
        const instancedMesh = new THREE.InstancedMesh(geometry, material, indices.length);
        
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const scale = new THREE.Vector3();
        
        for (let i = 0; i < indices.length; i++) {
            const particleIndex = indices[i];
            
            position.set(
                positions[particleIndex * 3],
                positions[particleIndex * 3 + 1],
                positions[particleIndex * 3 + 2]
            );
            
            // Scale based on mass
            const scaleValue = masses[particleIndex] * 2.0;
            scale.setScalar(scaleValue);
            
            matrix.compose(position, new THREE.Quaternion(), scale);
            instancedMesh.setMatrixAt(i, matrix);
        }
        
        instancedMesh.instanceMatrix.needsUpdate = true;
        return instancedMesh;
    }

    clearBatches() {
        for (const [type, batches] of this.batches) {
            for (const batch of batches) {
                if (batch.geometry) {
                    batch.geometry.dispose();
                }
            }
        }
        this.batches.clear();
    }

    clearInstancedBatches() {
        for (const [type, mesh] of this.instancedBatches) {
            this.scene.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
        }
        this.instancedBatches.clear();
    }

    /**
     * Update material uniforms (time, etc.)
     */
    updateUniforms(time) {
        for (const [type, material] of this.materials) {
            if (material.uniforms.time) {
                material.uniforms.time.value = time;
            }
        }
    }

    /**
     * Get rendering statistics
     */
    getStats() {
        let totalBatches = 0;
        let totalParticles = 0;
        
        for (const [type, batches] of this.batches) {
            totalBatches += batches.length;
            for (const batch of batches) {
                totalParticles += batch.geometry.drawRange.count;
            }
        }
        
        return {
            totalBatches,
            totalParticles,
            drawCalls: this.drawCallCounter,
            materialTypes: this.materials.size
        };
    }

    dispose() {
        this.clearBatches();
        this.clearInstancedBatches();
        
        // Dispose materials
        for (const [type, material] of this.materials) {
            material.dispose();
        }
        
        // Dispose batch geometries
        for (const [type, geometry] of this.batchGeometries) {
            geometry.dispose();
        }
    }
}
