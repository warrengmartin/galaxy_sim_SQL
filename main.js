import galaxyVortexShader from '/src/shaders/vertex.glsl';
import galaxyFragmentShader from '/src/shaders/fragment.glsl';
import computeShaderVelocity from '/src/shaders/computeShaderVelocity.glsl';
import computeShaderPosition from '/src/shaders/computeShaderPosition.glsl';
import {GUI} from "dat.gui";
import * as THREE from "three";
import Stats from "three/examples/jsm/libs/stats.module";

import {OrbitControls} from "three/examples/jsm/controls/OrbitControls";
import {GPUComputationRenderer} from "three/examples/jsm/misc/GPUComputationRenderer";
import {EffectComposer} from "three/examples/jsm/postprocessing/EffectComposer";
import {UnrealBloomPass} from "three/examples/jsm/postprocessing/UnrealBloomPass";
import {RenderPass} from "three/examples/jsm/postprocessing/RenderPass";
import {ShaderPass} from "three/examples/jsm/postprocessing/ShaderPass";
import {BlendShader} from "three/examples/jsm/shaders/BlendShader";
import {SavePass} from "three/examples/jsm/postprocessing/SavePass";
import {CopyShader} from "three/examples/jsm/shaders/CopyShader";

let container, stats;
let camera, scene, renderer, geometry, composer;

// Global animation frame tracking
let animationFrameId = null;
let frameSkipCounter = 0;
let skipEveryOtherFrame = false; // Set to true to skip every other frame for performance


let gpuCompute;
let velocityVariable;
let positionVariable;
let velocityUniforms;
let particleUniforms;
let effectController;
let particles;
let material;
let controls;
let luminosity;
let paused = false;
let autoRotation = false;
let bloom = { strength: 0.7};
let bloomPass;
// motion blur
let renderTargetParameters;
let savePass;
let blendPass;

// Controls how often to collect and send particle data to the backend database
// Higher values = fewer snapshots = better performance, less data
let snapshotFrameInterval = 2; // Skip every other frame (was 1 for every frame)

/*--------------------------INITIALISATION-----------------------------------------------*/
const gravity = 20;
const interactionRate = 1.0;
const timeStep = 0.001;
const blackHoleForce = 100.0;
const constLuminosity = 1.0;
const numberOfStars = 30000;
const radius = 100;
const height = 5;
const middleVelocity = 2;
const velocity = 15;
const typeOfSimulation = { "Galaxie": 1, "Univers": 2, "Collision de galaxies": 3 };
renderTargetParameters = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    stencilBuffer: false
};

// save pass
savePass = new SavePass(
    new THREE.WebGLRenderTarget(
        window.innerWidth,
        window.innerHeight,
        renderTargetParameters
    )
);

// blend pass
blendPass = new ShaderPass(BlendShader, "tDiffuse1");
blendPass.uniforms["tDiffuse2"].value = savePass.renderTarget.texture;
blendPass.uniforms["mixRatio"].value = 0.5;

// output pass
const outputPass = new ShaderPass(CopyShader);
outputPass.renderToScreen = true;

effectController = {
    // Can be changed dynamically
    gravity: 225.0,
    interactionRate: 0.05,
    timeStep: 0.0001,
    blackHoleForce: 100.0,
    luminosity: 0.25,
    maxAccelerationColor: 2.0,
    maxAccelerationColorPercent: 20,
    motionBlur: false,
    hideDarkMatter: false,

    // Must restart simulation
    numberOfStars: 100000,
    radius: 2,
    height: 5,
    middleVelocity: 2,
    velocity: 15,
    typeOfSimulation: 2,
    autoRotation: false
};

let PARTICLES = effectController.numberOfStars;

// 1 = normal mode ; 2 = experimental mode ; 3 = replay mode
let selectedChoice = 1;
document.getElementById("choice1").addEventListener("click", () => selectChoice(1));
document.getElementById("choice2").addEventListener("click", () => selectChoice(2));
document.getElementById("replayBtn").addEventListener("click", () => selectReplayMode());
document.getElementById("sqlViewBtn").addEventListener("click", () => selectSQLView());

function selectChoice(choice) {
    selectedChoice = choice;
    document.getElementById("main-container").remove();
    if (selectedChoice === 1){
        effectController = {
            // Can be changed dynamically
            gravity: 225.0,
            interactionRate: 0.05,
            timeStep: 0.0001,
            blackHoleForce: 100.0,
            luminosity: 0.25,
            maxAccelerationColor: 2.0,
            maxAccelerationColorPercent: 20,
            motionBlur: false,
            hideDarkMatter: false,

            // Must restart simulation
            numberOfStars: 100000,
            radius: 2,
            height: 5,
            middleVelocity: 2,
            velocity: 15,
            typeOfSimulation: 2,
            autoRotation: false
        };
    }
    init(effectController.typeOfSimulation.toString());
    animate();
}

// Hide the main menu
function hideMainMenu() {
    const mainContainer = document.getElementById('main-container');
    if (mainContainer) {
        mainContainer.remove();
    }
}

// Global playback configuration
let playbackConfig = {
    startFrame: 0,
    endFrame: 1000,
    frameSkip: 1, // 1 = no skip, 2 = skip every other frame, etc.
    totalFramesToDownload: 1000
};

// Handle selecting the replay mode from the main menu
function selectReplayMode() {
    console.log('Entering replay mode...');
    hideMainMenu();
    
    // Set that we're in replay mode
    selectedChoice = 3;
    
    // Show playback configuration dialog
    showPlaybackConfigDialog();
}

// Show configuration dialog for playback settings
function showPlaybackConfigDialog() {
    // Create modal dialog
    const modal = document.createElement('div');
    modal.className = 'playback-config-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
    `;
    
    const dialog = document.createElement('div');
    dialog.style.cssText = `
        background: #1a1a1a;
        padding: 30px;
        border-radius: 10px;
        border: 2px solid #4a9eff;
        color: white;
        font-family: 'Courier New', monospace;
        max-width: 500px;
        width: 90%;
    `;
    
    dialog.innerHTML = `
        <h2 style="color: #4a9eff; margin-top: 0;">Playback Configuration</h2>
        
        <div style="margin: 20px 0;">
            <label style="display: block; margin-bottom: 5px;">Start Frame:</label>
            <input type="number" id="startFrameInput" value="${playbackConfig.startFrame}" 
                   min="0" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid #4a9eff; background: #2a2a2a; color: white;">
        </div>
        
        <div style="margin: 20px 0;">
            <label style="display: block; margin-bottom: 5px;">End Frame:</label>
            <input type="number" id="endFrameInput" value="${playbackConfig.endFrame}" 
                   min="1" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid #4a9eff; background: #2a2a2a; color: white;">
        </div>
        
        <div style="margin: 20px 0;">
            <label style="display: block; margin-bottom: 5px;">Frame Skip (1=no skip, 2=every other, 3=every 3rd, etc.):</label>
            <input type="number" id="frameSkipInput" value="${playbackConfig.frameSkip}" 
                   min="1" max="10" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid #4a9eff; background: #2a2a2a; color: white;">
        </div>
        
        <div style="margin: 20px 0;">
            <small style="color: #888;">
                • Start Frame: Where to begin playback (usually 0)<br>
                • End Frame: Where to stop playback<br>
                • Frame Skip: How many frames to skip during download/playback<br>
                  (1=no skip, 2=every other frame, 3=every 3rd frame, etc.)<br>
                <br>
                Total frames to download: <span id="totalFramesCalc">${Math.ceil((playbackConfig.endFrame - playbackConfig.startFrame) / playbackConfig.frameSkip)}</span><br>
                Actual frame range: ${playbackConfig.startFrame} to ${playbackConfig.endFrame} (every ${playbackConfig.frameSkip} frames)
            </small>
        </div>
        
        <div style="display: flex; gap: 10px; margin-top: 25px;">
            <button id="startPlaybackBtn" style="flex: 1; padding: 12px; background: #4a9eff; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                Start Playback
            </button>
            <button id="cancelPlaybackBtn" style="flex: 1; padding: 12px; background: #666; color: white; border: none; border-radius: 4px; cursor: pointer;">
                Cancel
            </button>
        </div>
    `;
    
    modal.appendChild(dialog);
    document.body.appendChild(modal);
    
    // Update total frames calculation when inputs change
    function updateTotalFrames() {
        const start = parseInt(document.getElementById('startFrameInput').value) || 0;
        const end = parseInt(document.getElementById('endFrameInput').value) || 1000;
        const skip = parseInt(document.getElementById('frameSkipInput').value) || 1;
        const total = Math.ceil(Math.max(0, end - start) / skip);
        document.getElementById('totalFramesCalc').textContent = total;
    }
    
    document.getElementById('startFrameInput').addEventListener('input', updateTotalFrames);
    document.getElementById('endFrameInput').addEventListener('input', updateTotalFrames);
    document.getElementById('frameSkipInput').addEventListener('input', updateTotalFrames);
    
    // Handle start playback button
    document.getElementById('startPlaybackBtn').addEventListener('click', () => {
        const startFrame = parseInt(document.getElementById('startFrameInput').value) || 0;
        const endFrame = parseInt(document.getElementById('endFrameInput').value) || 1000;
        const frameSkip = parseInt(document.getElementById('frameSkipInput').value) || 1;
        
        // Validate inputs
        if (startFrame < 0) {
            alert('Start frame must be 0 or greater');
            return;
        }
        if (endFrame <= startFrame) {
            alert('End frame must be greater than start frame');
            return;
        }
        if (frameSkip < 1 || frameSkip > 10) {
            alert('Frame skip must be between 1 and 10');
            return;
        }
        
        // Update global config
        playbackConfig.startFrame = startFrame;
        playbackConfig.endFrame = endFrame;
        playbackConfig.frameSkip = frameSkip;
        playbackConfig.totalFramesToDownload = Math.ceil((endFrame - startFrame) / frameSkip);
        
        // Remove modal
        document.body.removeChild(modal);
        
        // Start the actual playback setup
        startPlaybackWithConfig();
    });
    
    // Handle cancel button
    document.getElementById('cancelPlaybackBtn').addEventListener('click', () => {
        document.body.removeChild(modal);
        showMainMenu();
    });
}

// Start playback with the configured settings
function startPlaybackWithConfig() {
    console.log('Starting playback with config:', playbackConfig);
    
    // Initialize basic scene components for replay mode
    initReplayScene();
    
    // Start the animation loop if not already running
    if (!window.animationFrameId) {
        animate();
    }
    
    // Show loading message and load playback data
    showLoadingMessage(`Downloading ${playbackConfig.totalFramesToDownload} frames (${playbackConfig.startFrame} to ${playbackConfig.endFrame}, every ${playbackConfig.frameSkip} frames)...`);
    
    // Try to fetch with the configured parameters
    const url = `http://localhost:3001/playback/export?start=${playbackConfig.startFrame}&end=${playbackConfig.endFrame}&skip=${playbackConfig.frameSkip}`;
    tryFetchPlaybackData(url, true);
}

// Initialize a basic Three.js scene for replay mode
function initReplayScene() {
    console.log('Initializing replay scene...');
    
    // Initialize effect controller with default values
    effectController = {
        gravity: 225.0,
        interactionRate: 0.05,
        timeStep: 0.0001,
        blackHoleForce: 100.0,
        luminosity: 0.25,
        maxAccelerationColor: 2.0,
        maxAccelerationColorPercent: 20,
        motionBlur: false,
        hideDarkMatter: false,
        numberOfStars: 100000,
        radius: 2,
        height: 5,
        middleVelocity: 2,
        velocity: 15,
        typeOfSimulation: 2,
        autoRotation: false
    };
    
    // Create scene
    if (!scene) {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000);
    }
    
    // Create camera
    if (!camera) {
        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
        camera.position.set(0, 0, 100);
        camera.lookAt(0, 0, 0);
    }
    
    // Create renderer
    if (!renderer) {
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setClearColor(0x000000);
        document.body.appendChild(renderer.domElement);
    }
    
    // Create controls
    if (!controls) {
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.enableZoom = true;
        controls.autoRotate = false;
    }
    
    // Create stats if not exists
    if (!stats) {
        stats = new Stats();
        stats.domElement.style.position = 'absolute';
        stats.domElement.style.top = '0px';
        stats.domElement.style.left = '0px';
        document.body.appendChild(stats.domElement);
    }
    
    console.log('Replay scene initialized successfully');
}

// Helper function to try fetching playback data with fallback
function tryFetchPlaybackData(url, canRetry = true) {
    console.log('Attempting to fetch playback data from:', url);
    fetch(url)
        .then(response => {
            console.log('Response received:', response.status, response.statusText);
            if (!response.ok) {
                throw new Error(`Network response was not ok: ${response.status} ${response.statusText}`);
            }
            return response.arrayBuffer();
        })
        .then(arrayBuffer => {
            console.log('Playback data received successfully, size:', arrayBuffer.byteLength);
            hideLoadingMessage();
            // Parse and prepare the playback data
            preparePlaybackSimulation(arrayBuffer);
        })
        .catch(error => {
            console.error('Error fetching playback data:', error);
            console.error('Error details:', error.message, error.stack);
            
            // Try the fallback URL if this was the first attempt
            if (canRetry) {
                console.log('Trying fallback URL...');
                const fallbackUrl = `http://127.0.0.1:3001/playback/export?start=${playbackConfig.startFrame}&end=${playbackConfig.endFrame}&skip=${playbackConfig.frameSkip}`;
                tryFetchPlaybackData(fallbackUrl, false);
            } else {
                hideLoadingMessage();
                alert('Failed to fetch playback data. Check browser console for details. Make sure the backend server is running at http://localhost:3001');
                
                // Return to main menu on error
                restartSimulation();
                showMainMenu();
            }
        });
}

// Replay data globals
let playbackData = null;
let playbackFrames = {};
let playbackFrameNumbers = [];
let currentPlaybackFrame = 0;
let isPlaying = false;
let playbackInterval = null;
let playbackSpeed = 30; // ms between frames, initially at ~30fps

// Prepare playback data and UI
function preparePlaybackSimulation(arrayBuffer) {
    console.log('Preparing playback simulation with data of size:', arrayBuffer.byteLength);
    
    // Each row: [frame_number, particle_index, x, y, z, vx, vy, vz]
    const floatsPerRow = 8;
    playbackData = new Float32Array(arrayBuffer);
    
    // Group by frame_number
    playbackFrames = {};
    let maxParticleIndex = 0;
    
    for (let i = 0; i < playbackData.length; i += floatsPerRow) {
        const frameNum = playbackData[i];
        const particleIndex = playbackData[i+1];
        
        if (!playbackFrames[frameNum]) playbackFrames[frameNum] = [];
        
        playbackFrames[frameNum].push({
            particle_index: particleIndex,
            x: playbackData[i+2], 
            y: playbackData[i+3], 
            z: playbackData[i+4],
            vx: playbackData[i+5], 
            vy: playbackData[i+6], 
            vz: playbackData[i+7]
        });
        
        maxParticleIndex = Math.max(maxParticleIndex, particleIndex);
    }
    
    // Sort frame numbers
    playbackFrameNumbers = Object.keys(playbackFrames).map(Number).sort((a,b) => a-b);
    console.log('Parsed frames:', playbackFrameNumbers.length, 'with max particle index:', maxParticleIndex);
    
    // Stop any existing simulation
    paused = true;
    
    // Create or update particle system for replay
    setupReplayParticleSystem(maxParticleIndex + 1);
    
    // Position camera for better view
    if (camera) {
        camera.position.set(0, 0, 100);
        camera.lookAt(0, 0, 0);
        if (controls) {
            controls.update();
        }
    }
    
    // Create playback UI controls
    createPlaybackControls();
    
    // Show first frame immediately
    showPlaybackFrame(0);
    
    // Start playback automatically
    togglePlayback();
}

// Setup particle system specifically for replay mode
function setupReplayParticleSystem(particleCount) {
    console.log('Setting up replay particle system for', particleCount, 'particles');
    
    // Remove existing particles if any
    if (particles && scene) {
        scene.remove(particles);
    }
    
    // Create new geometry with correct particle count
    geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    
    // Initialize with default positions and colors
    for (let i = 0; i < particleCount; i++) {
        positions[i * 3] = 0;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = 0;
        
        colors[i * 3] = 1.0;     // R
        colors[i * 3 + 1] = 1.0; // G  
        colors[i * 3 + 2] = 1.0; // B
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    // Create material for replay particles
    material = new THREE.PointsMaterial({
        size: 2.0,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0.8
    });
    
    // Create particle system
    particles = new THREE.Points(geometry, material);
    
    // Add to scene
    if (scene) {
        scene.add(particles);
        console.log('Added particles to scene');
    }
}

// Create the playback controls UI
function createPlaybackControls() {
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'playback-controls';
    controlsDiv.id = 'playbackControls';
    controlsDiv.innerHTML = `
        <div style="display: flex; margin-bottom: 10px;">
            <button id="playPauseBtn">Pause</button>
            <button id="backBtn">◀◀ Back</button>
            <button id="stepBackBtn">◀ Frame</button>
            <button id="stepForwardBtn">Frame ▶</button>
            <button id="fwdBtn">Forward ▶▶</button>
            <button id="menuBtn">Back to Menu</button>
        </div>
        <div class="playback-progress">
            <div class="progress-bar">
                <div class="progress-fill" id="progressFill"></div>
                <div class="progress-handle" id="progressHandle"></div>
            </div>
            <div class="frame-info" id="frameInfo">Frame: 0/${playbackFrameNumbers.length-1}</div>
            <div style="color: #888; font-size: 12px; margin-top: 5px;">
                Frame Range: ${playbackConfig.startFrame} - ${playbackConfig.endFrame} | Skip: every ${playbackConfig.frameSkip} frame(s) | Downloaded: ${playbackFrameNumbers.length} frames
            </div>
        </div>
    `;
    document.body.appendChild(controlsDiv);
    
    // Set up button event handlers
    document.getElementById('playPauseBtn').addEventListener('click', togglePlayback);
    document.getElementById('backBtn').addEventListener('click', () => {
        if (currentPlaybackFrame - 10 >= 0) {
            showPlaybackFrame(currentPlaybackFrame - 10);
        } else {
            showPlaybackFrame(0);
        }
        updateProgressUI();
    });
    document.getElementById('stepBackBtn').addEventListener('click', () => {
        if (currentPlaybackFrame > 0) {
            showPlaybackFrame(currentPlaybackFrame - 1);
        }
        updateProgressUI();
    });
    document.getElementById('stepForwardBtn').addEventListener('click', () => {
        if (currentPlaybackFrame < playbackFrameNumbers.length - 1) {
            showPlaybackFrame(currentPlaybackFrame + 1);
        }
        updateProgressUI();
    });
    document.getElementById('fwdBtn').addEventListener('click', () => {
        if (currentPlaybackFrame + 10 < playbackFrameNumbers.length) {
            showPlaybackFrame(currentPlaybackFrame + 10);
        } else {
            showPlaybackFrame(playbackFrameNumbers.length - 1);
        }
        updateProgressUI();
    });
    document.getElementById('menuBtn').addEventListener('click', () => {
        // Stop playback and return to main menu
        stopPlayback();
        
        // Remove playback controls
        const controls = document.getElementById('playbackControls');
        if (controls) controls.remove();
        
        // Return to main menu
        showMainMenu();
    });
    
    // Set up scrubber/progress bar
    const progressBar = document.querySelector('.progress-bar');
    const progressHandle = document.getElementById('progressHandle');
    
    // Handle click on progress bar
    progressBar.addEventListener('click', function(e) {
        const rect = this.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = x / rect.width;
        const frameIndex = Math.floor(percent * (playbackFrameNumbers.length - 1));
        showPlaybackFrame(frameIndex);
        updateProgressUI();
    });
    
    // Handle drag on progress handle
    let isDragging = false;
    progressHandle.addEventListener('mousedown', function(e) {
        isDragging = true;
        e.preventDefault(); // Prevent text selection
    });
    
    document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        
        const progressBar = document.querySelector('.progress-bar');
        const rect = progressBar.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        const percent = x / rect.width;
        
        // Update handle position visually
        progressHandle.style.left = `${percent * 100}%`;
        document.getElementById('progressFill').style.width = `${percent * 100}%`;
    });
    
    document.addEventListener('mouseup', function(e) {
        if (!isDragging) return;
        isDragging = false;
        
        // Calculate the frame to show
        const progressBar = document.querySelector('.progress-bar');
        const rect = progressBar.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        const percent = x / rect.width;
        const frameIndex = Math.floor(percent * (playbackFrameNumbers.length - 1));
        
        showPlaybackFrame(frameIndex);
        updateProgressUI();
    });
}

// Update the playback progress UI
function updateProgressUI() {
    const percent = playbackFrameNumbers.length > 1 
        ? currentPlaybackFrame / (playbackFrameNumbers.length - 1) 
        : 0;
    
    document.getElementById('progressFill').style.width = `${percent * 100}%`;
    document.getElementById('progressHandle').style.left = `${percent * 100}%`;
    document.getElementById('frameInfo').textContent = 
        `Frame: ${currentPlaybackFrame}/${playbackFrameNumbers.length-1}`;
}

// Show a specific frame of the playback
function showPlaybackFrame(frameIndex) {
    if (frameIndex < 0 || frameIndex >= playbackFrameNumbers.length) {
        console.warn('Invalid frame index:', frameIndex);
        return;
    }
    
    currentPlaybackFrame = frameIndex;
    const frameNumber = playbackFrameNumbers[frameIndex];
    const frameData = playbackFrames[frameNumber];
    
    if (!frameData) {
        console.warn('No frame data for frame number:', frameNumber);
        return;
    }
    
    if (!geometry || !geometry.attributes.position) {
        console.warn('Geometry or position attribute not available');
        return;
    }
    
    const positions = geometry.attributes.position.array;
    console.log(`Showing frame ${frameIndex} (frame number ${frameNumber}) with ${frameData.length} particles`);
    
    // Clear all positions first
    for (let i = 0; i < positions.length; i++) {
        positions[i] = 0;
    }
    
    // Update particle positions
    let updatedCount = 0;
    for (let i = 0; i < frameData.length; i++) {
        const particle = frameData[i];
        const idx = Math.floor(particle.particle_index);
        
        // Make sure we don't go out of bounds
        if (idx >= 0 && idx * 3 + 2 < positions.length) {
            positions[idx * 3] = particle.x;
            positions[idx * 3 + 1] = particle.y;
            positions[idx * 3 + 2] = particle.z;
            updatedCount++;
        }
    }
    
    console.log(`Updated ${updatedCount} particles out of ${frameData.length}`);
    
    // Tell three.js to update the geometry
    geometry.attributes.position.needsUpdate = true;
    
    // Force render
    if (renderer && scene && camera) {
        renderer.render(scene, camera);
    }
}

// Toggle playback play/pause
function togglePlayback() {
    isPlaying = !isPlaying;
    
    const playPauseBtn = document.getElementById('playPauseBtn');
    
    if (isPlaying) {
        playPauseBtn.textContent = 'Pause';
        playbackInterval = setInterval(advancePlayback, playbackSpeed);
    } else {
        playPauseBtn.textContent = 'Play';
        stopPlayback();
    }
}

// Stop the playback interval
function stopPlayback() {
    if (playbackInterval) {
        clearInterval(playbackInterval);
        playbackInterval = null;
    }
    isPlaying = false;
}

// Advance to the next frame
function advancePlayback() {
    if (currentPlaybackFrame < playbackFrameNumbers.length - 1) {
        // Use configurable frame skip
        const frameIncrement = playbackConfig.frameSkip;
        const nextFrame = Math.min(currentPlaybackFrame + frameIncrement, playbackFrameNumbers.length - 1);
        showPlaybackFrame(nextFrame);
        updateProgressUI();
    } else {
        // Reached the end, stop playback
        stopPlayback();
        document.getElementById('playPauseBtn').textContent = 'Play';
    }
}

// Modify the animate function to handle replay mode
function animate() {
    if (controls) controls.update();
    animationFrameId = requestAnimationFrame(animate);
    
    // Handle rendering based on mode
    if (selectedChoice === 3) {
        // Replay mode - always render the current frame
        if (renderer && scene && camera) {
            renderer.render(scene, camera);
        }
    } else if (selectedChoice !== 3) {
        // Normal simulation mode
        render();
    }
    
    if (stats) stats.update();
}

function render() {
    if (!paused){
        gpuCompute.compute();
        particleUniforms[ 'texturePosition' ].value = gpuCompute.getCurrentRenderTarget( positionVariable ).texture;
        particleUniforms[ 'textureVelocity' ].value = gpuCompute.getCurrentRenderTarget( velocityVariable ).texture;
        material.uniforms.uMaxAccelerationColor.value = effectController.maxAccelerationColor;
    }
    if (effectController.motionBlur){
        composer.removePass(blendPass);
        composer.removePass(savePass);
        composer.removePass(outputPass);
        composer.addPass(blendPass);
        composer.addPass(savePass);
        composer.addPass(outputPass);
    } else {
        composer.removePass(blendPass);
        composer.removePass(savePass);
        composer.removePass(outputPass);
    }
    material.uniforms.uLuminosity.value = effectController.luminosity;
    material.uniforms.uHideDarkMatter.value = effectController.hideDarkMatter;
    composer.render(scene, camera);

    // Send snapshots every N frames
    if (frameNumber % snapshotFrameInterval === 0) {
        collectAndSendParticleSnapshots();
    }
}

// Store previous velocities for acceleration calculation
let previousVelocities = null;
let frameNumber = 0;

async function sendParticleSnapshotsToBackend(snapshots) {
    const BATCH_SIZE = 5000;
    const MAX_RETRIES = 5;
    const BASE_DELAY = 20; // ms
    for (let idx = 0; idx < snapshots.length; idx += BATCH_SIZE) {
        const batch = snapshots.slice(idx, idx + BATCH_SIZE);
        let attempt = 0;
        while (attempt < MAX_RETRIES) {
            try {
                const res = await fetch('http://localhost:3001/particle_snapshots', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(batch)
                });
                if (res.ok) {
                    console.log(`Particle snapshots sent to backend. Batch: ${Math.floor(idx/BATCH_SIZE)+1}`);
                    break;
                } else {
                    throw new Error('Server error');
                }
            } catch (e) {
                attempt++;
                if (attempt >= MAX_RETRIES) {
                    console.error('Failed to send particle snapshots to backend after retries.');
                    break;
                }
                const delay = BASE_DELAY * Math.pow(2, attempt);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
}

// 1. Make collectAndSendParticleSnapshots async and await sendParticleSnapshotsToBackend
async function collectAndSendParticleSnapshots() {
    // Get current positions and velocities from GPU
    const posTexture = gpuCompute.getCurrentRenderTarget(positionVariable).texture;
    const velTexture = gpuCompute.getCurrentRenderTarget(velocityVariable).texture;
    const size = Math.round(Math.sqrt(effectController.numberOfStars));
    const gl = renderer.getContext();
    // Create buffers to read data
    const posBuffer = new Float32Array(size * size * 4);
    const velBuffer = new Float32Array(size * size * 4);
    // Read data from GPU
    renderer.readRenderTargetPixels(
        gpuCompute.getCurrentRenderTarget(positionVariable),
        0, 0, size, size, posBuffer
    );
    renderer.readRenderTargetPixels(
        gpuCompute.getCurrentRenderTarget(velocityVariable),
        0, 0, size, size, velBuffer
    );
    // Calculate acceleration if possible
    let accBuffer = null;
    if (previousVelocities) {
        accBuffer = new Float32Array(size * size * 4);
        for (let i = 0; i < velBuffer.length; i += 4) {
            accBuffer[i] = (velBuffer[i] - previousVelocities[i]) / effectController.timeStep;
            accBuffer[i+1] = (velBuffer[i+1] - previousVelocities[i+1]) / effectController.timeStep;
            accBuffer[i+2] = (velBuffer[i+2] - previousVelocities[i+2]) / effectController.timeStep;
            accBuffer[i+3] = 0;
        }
    }
    // Build snapshot array
    const snapshots = [];
    
    // Determine sampling rate based on number of particles
    // For very large simulations, we only save a fraction of the particles
    const totalParticles = posBuffer.length / 4;
    let samplingRate = 1; // Default: save all particles
    
    if (totalParticles > 100000) {
        samplingRate = Math.floor(totalParticles / 10000); // Save approximately 10,000 particles
    } else if (totalParticles > 10000) {
        samplingRate = Math.floor(totalParticles / 1000); // Save approximately 1,000 particles
    }
    
    for (let k = 0, idx = 0; k < posBuffer.length; k += 4, idx++) {
        // Apply sampling to reduce data volume
        if (idx % samplingRate !== 0) continue;
        
        const x = posBuffer[k], y = posBuffer[k+1], z = posBuffer[k+2];
        const vx = velBuffer[k], vy = velBuffer[k+1], vz = velBuffer[k+2];
        const speed = Math.sqrt(vx*vx + vy*vy + vz*vz);
        let ax = 0, ay = 0, az = 0, force = 0;
        if (accBuffer) {
            ax = accBuffer[k];
            ay = accBuffer[k+1];
            az = accBuffer[k+2];
            // For now, force is just magnitude of acceleration (mass=1)
            force = Math.sqrt(ax*ax + ay*ay + az*az);
        }
        snapshots.push({
            frame_number: frameNumber,
            particle_index: idx,
            x, y, z, vx, vy, vz, speed, ax, ay, az, force
        });
    }
    await sendParticleSnapshotsToBackend(snapshots);
    previousVelocities = velBuffer.slice();
    frameNumber++;
    // Log the sampling statistics
    if (frameNumber % 10 === 0) {
        console.log(`Snapshot data processed for frame ${frameNumber}: ${snapshots.length} particles (sampling rate: 1:${samplingRate})`);
    }
}

function showLoadingMessage(message) {
    let loadingDiv = document.getElementById('loading-message');
    if (!loadingDiv) {
        loadingDiv = document.createElement('div');
        loadingDiv.id = 'loading-message';
        loadingDiv.style.position = 'fixed';
        loadingDiv.style.top = '50%';
        loadingDiv.style.left = '50%';
        loadingDiv.style.transform = 'translate(-50%, -50%)';
        loadingDiv.style.background = 'rgba(0,0,0,0.8)';
        loadingDiv.style.color = '#fff';
        loadingDiv.style.padding = '2em 3em';
        loadingDiv.style.fontSize = '2em';
        loadingDiv.style.borderRadius = '1em';
        loadingDiv.style.zIndex = '9999';
        document.body.appendChild(loadingDiv);
    }
    loadingDiv.innerText = message;
}

function hideLoadingMessage() {
    const loadingDiv = document.getElementById('loading-message');
    if (loadingDiv) loadingDiv.remove();
}

let simPrimed = false;
let startButton = null;

function primeSimulation() {
    paused = true;
    showLoadingMessage('Loading particles...');
    setTimeout(() => {
        showLoadingMessage('Ready!');
        if (!startButton) {
            startButton = document.createElement('button');
            startButton.innerText = 'Start Simulation';
            startButton.style.position = 'fixed';
            startButton.style.top = '60%';
            startButton.style.left = '50%';
            startButton.style.transform = 'translate(-50%, -50%)';
            startButton.style.fontSize = '1.5em';
            startButton.style.padding = '0.5em 2em';
            startButton.style.zIndex = '10000';
            startButton.onclick = () => {
                paused = false;
                hideLoadingMessage();
                startButton.remove();
                startButton = null;
            };
            document.body.appendChild(startButton);
        }
    }, 500); // Simulate short loading
}

async function sendParticlesToBackend(posArray, velArray) {
    const BATCH_SIZE = 10000;
    const MAX_RETRIES = 5;
    const BASE_DELAY = 10; // ms
    const particlesData = [];
    for (let k = 0, kl = posArray.length; k < kl; k += 4) {
        particlesData.push({
            x: posArray[k],
            y: posArray[k+1],
            z: posArray[k+2],
            vx: velArray[k],
            vy: velArray[k+1],
            vz: velArray[k+2]
        });
    }
    for (let idx = 0; idx < particlesData.length; idx += BATCH_SIZE) {
        const batch = particlesData.slice(idx, idx + BATCH_SIZE);
        let attempt = 0;
        while (attempt < MAX_RETRIES) {
            try {
                const res = await fetch('http://localhost:3001/particles', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(batch)
                });
                if (res.ok) {
                    console.log(`Particles sent to backend. Batch: ${Math.floor(idx/BATCH_SIZE)+1}`);
                    break;
                } else {
                    throw new Error('Server error');
                }
            } catch (e) {
                attempt++;
                if (attempt >= MAX_RETRIES) {
                    console.error('Failed to send particles to backend after retries.');
                    break;
                }
                const delay = BASE_DELAY * Math.pow(2, attempt);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
}

// Add event listener for the headless button directly (now in HTML)
window.addEventListener('DOMContentLoaded', () => {
    const headlessBtn = document.getElementById('headlessBtn');
    if (headlessBtn) {
        headlessBtn.onclick = showHeadlessPrompt;
    }
});

// Show a prompt/form for headless parameters
function showHeadlessPrompt() {
    // Remove menu for clarity
    const mainContainer = document.getElementById('main-container');
    if (mainContainer) mainContainer.remove();
    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'headless-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = 'rgba(0,0,0,0.85)';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.style.zIndex = '9999';
    // Form
    const form = document.createElement('form');
    form.style.background = '#222';
    form.style.padding = '2em 3em';
    form.style.borderRadius = '1em';
    form.style.display = 'flex';
    form.style.flexDirection = 'column';
    form.style.gap = '1em';
    form.style.color = '#fff';
    form.innerHTML = `
        <h2>Headless Simulation</h2>
        <label>Frames per second: <input id="headless-fps" type="number" min="1" max="1000" value="110" /></label>
        <label>Duration (minutes): <input id="headless-mins" type="number" min="1" max="120" value="5" /></label>
        <label><input id="clear-db" type="checkbox" /> Overwrite database (delete all previous data)</label>
        <button type="submit" class="button">Start Headless</button>
    `;
    form.onsubmit = async function(e) {
        e.preventDefault();
        const fps = parseInt(document.getElementById('headless-fps').value, 10) || 110;
        const mins = parseInt(document.getElementById('headless-mins').value, 10) || 5;
        const clearDb = document.getElementById('clear-db').checked;
        overlay.remove();
        if (clearDb) {
            await clearDatabase();
        }
        await primeHeadlessSimulation({ fps, mins });
    };
    overlay.appendChild(form);
    document.body.appendChild(overlay);
}

// Function to clear the database by calling backend endpoint
async function clearDatabase() {
    showLoadingMessage('Clearing database...');
    try {
        await fetch('http://localhost:3001/maintenance/clear', { method: 'POST' });
    } catch (e) {
        alert('Failed to clear database. Please check backend.');
    }
    hideLoadingMessage();
}

// Headless pause/start logic and loading screen
let headlessPaused = true;
let headlessShouldStop = false;
let headlessProgressDiv = null;

async function primeHeadlessSimulation({ fps, mins }) {
    const totalFrames = fps * mins * 60;
    effectController = {
        gravity: 225.0,
        interactionRate: 0.05,
        timeStep: 0.0001,
        blackHoleForce: 100.0,
        luminosity: 0.25,
        maxAccelerationColor: 2.0,
        maxAccelerationColorPercent: 20,
        motionBlur: false,
        hideDarkMatter: false,
        numberOfStars: 100000,
        radius: 2,
        height: 5,
        middleVelocity: 2,
        velocity: 15,
        typeOfSimulation: 2,
        autoRotation: false
    };
    PARTICLES = effectController.numberOfStars;
    const canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    renderer.setSize(1, 1);
    let textureSize = Math.round(Math.sqrt(effectController.numberOfStars));
    gpuCompute = new GPUComputationRenderer(textureSize, textureSize, renderer);
    if (renderer.capabilities.isWebGL2 === false) {
        gpuCompute.setDataType(THREE.HalfFloatType);
    }
    const dtPosition = gpuCompute.createTexture();
    const dtVelocity = gpuCompute.createTexture();
    await fillUniverseTextures(dtPosition, dtVelocity);
    velocityVariable = gpuCompute.addVariable('textureVelocity', computeShaderVelocity, dtVelocity);
    positionVariable = gpuCompute.addVariable('texturePosition', computeShaderPosition, dtPosition);
    gpuCompute.setVariableDependencies(velocityVariable, [positionVariable, velocityVariable]);
    gpuCompute.setVariableDependencies(positionVariable, [positionVariable, velocityVariable]);
    velocityUniforms = velocityVariable.material.uniforms;
    velocityUniforms['gravity'] = { value: effectController.gravity };
    velocityUniforms['interactionRate'] = { value: effectController.interactionRate };
    velocityUniforms['timeStep'] = { value: effectController.timeStep };
    velocityUniforms['uMaxAccelerationColor'] = { value: effectController.maxAccelerationColor };
    velocityUniforms['blackHoleForce'] = { value: effectController.blackHoleForce };
    velocityUniforms['luminosity'] = { value: effectController.luminosity };
    const error = gpuCompute.init();
    if (error !== null) {
        alert('Error initializing GPUComputationRenderer: ' + error);
        return;
    }
    previousVelocities = null;
    frameNumber = 0;
    headlessPaused = true;
    headlessShouldStop = false;
    // Show loading/progress UI
    showHeadlessLoadingScreen({ fps, mins, totalFrames });
}

function showHeadlessLoadingScreen({ fps, mins, totalFrames }) {
    // Remove any previous
    if (headlessProgressDiv) headlessProgressDiv.remove();
    headlessProgressDiv = document.createElement('div');
    headlessProgressDiv.id = 'headless-progress';
    headlessProgressDiv.style.position = 'fixed';
    headlessProgressDiv.style.top = '0';
    headlessProgressDiv.style.left = '0';
    headlessProgressDiv.style.width = '100vw';
    headlessProgressDiv.style.height = '100vh';
    headlessProgressDiv.style.background = 'rgba(0,0,0,0.85)';
    headlessProgressDiv.style.display = 'flex';
    headlessProgressDiv.style.flexDirection = 'column';
    headlessProgressDiv.style.justifyContent = 'center';
    headlessProgressDiv.style.alignItems = 'center';
    headlessProgressDiv.style.zIndex = '10000';
    headlessProgressDiv.innerHTML = `
        <div style="background:#222;padding:2em 3em;border-radius:1em;color:#fff;display:flex;flex-direction:column;align-items:center;gap:1em;">
            <h2>Particles initialized!</h2>
            <p>Ready to run headless simulation for <b>${mins} min</b> at <b>${fps} fps</b> (${totalFrames} frames).</p>
            <button id="start-headless-btn" class="button" style="font-size:1.2em;padding:0.5em 2em;">Start Simulation</button>
            <button id="cancel-headless-btn" class="button" style="font-size:1em;padding:0.3em 1.5em;background:#444;">Cancel</button>
            <div id="headless-progress-bar" style="width:300px;height:20px;background:#444;border-radius:10px;overflow:hidden;margin-top:1em;display:none;">
                <div id="headless-progress-fill" style="height:100%;width:0%;background:#4caf50;"></div>
            </div>
            <div id="headless-progress-text" style="margin-top:0.5em;display:none;"></div>
        </div>
    `;
    document.body.appendChild(headlessProgressDiv);
    document.getElementById('start-headless-btn').onclick = () => {
        headlessPaused = false;
        document.getElementById('start-headless-btn').disabled = true;
        document.getElementById('cancel-headless-btn').disabled = true;
        runHeadlessSimulationWithProgress({ fps, mins, totalFrames });
    };
    document.getElementById('cancel-headless-btn').onclick = () => {
        headlessShouldStop = true;
        headlessProgressDiv.remove();
        showMainMenu(); // Restore main menu after cancel
    };
}

async function runHeadlessSimulationWithProgress({ fps, mins, totalFrames }) {
    showHeadlessProgressBar(0, totalFrames, 0, fps, mins);
    let startTime = Date.now();
    for (let i = 0; i < totalFrames; i++) {
        if (headlessShouldStop) break;
        while (headlessPaused) await new Promise(r => setTimeout(r, 100));
        gpuCompute.compute();
        if (i % snapshotFrameInterval === 0) {
            await collectAndSendParticleSnapshots();
        }
        if (i % 10 === 0) {
            let elapsed = (Date.now() - startTime) / 1000;
            let percent = (i + 1) / totalFrames;
            let estTotal = percent > 0 ? elapsed / percent : 0;
            let estRemain = estTotal - elapsed;
            showHeadlessProgressBar(i + 1, totalFrames, estRemain, fps, mins);
            await new Promise(r => setTimeout(r, 0));
        }
    }
    if (headlessProgressDiv) headlessProgressDiv.remove();
    // After simulation, show main menu again
    showMainMenu();
    alert('Headless simulation complete!');
}

function showHeadlessProgressBar(current, total, secondsLeft, fps, mins) {
    const bar = document.getElementById('headless-progress-bar');
    const fill = document.getElementById('headless-progress-fill');
    const text = document.getElementById('headless-progress-text');
    if (!bar || !fill || !text) return;
    bar.style.display = 'block';
    text.style.display = 'block';
    let percent = Math.floor((current / total) * 100);
    fill.style.width = percent + '%';
    let min = Math.floor(secondsLeft / 60);
    let sec = Math.floor(secondsLeft % 60);
    text.innerHTML = `Progress: ${percent}% &mdash; ~${min}m ${sec}s remaining`;
}

// Add a function to show the main menu (simulation choice)
function showMainMenu() {
    // Remove any overlays
    const overlay = document.getElementById('headless-overlay');
    if (overlay) overlay.remove();
    // Recreate the main menu container
    if (!document.getElementById('main-container')) {
        const mainContainer = document.createElement('div');
        mainContainer.id = 'main-container';
        mainContainer.style.position = 'fixed';
        mainContainer.style.top = '0';
        mainContainer.style.left = '0';
        mainContainer.style.width = '100vw';
        mainContainer.style.height = '100vh';
        mainContainer.style.background = 'rgba(0,0,0,0.85)';
        mainContainer.style.display = 'flex';
        mainContainer.style.flexDirection = 'column';
        mainContainer.style.justifyContent = 'center';
        mainContainer.style.alignItems = 'center';
        mainContainer.style.zIndex = '9999';
        mainContainer.innerHTML = `
            <h2 style='color:#fff'>Choose Simulation Type</h2>
            <button id="choice1" class="button" style="margin:1em;font-size:1.2em;">Normal Mode</button>
            <button id="choice2" class="button" style="margin:1em;font-size:1.2em;">Experimental Mode</button>
            <button id="headlessBtn" class="button" style="margin:1em;font-size:1.2em;">Headless Mode</button>
        `;
        document.body.appendChild(mainContainer);
        document.getElementById("choice1").onclick = () => selectChoice(1);
        document.getElementById("choice2").onclick = () => selectChoice(2);
        document.getElementById("headlessBtn").onclick = showHeadlessPrompt;
    }
}

// Restart the simulation
function restartSimulation() {
    paused = false;
    if (scene && particles) scene.remove(particles);
    if (material) material.dispose && material.dispose();
    if (geometry) geometry.dispose && geometry.dispose();
    const guiElements = document.getElementsByClassName('dg ac');
    if (guiElements.length > 0) {
        const mainGui = document.getElementsByClassName('dg main a');
        if (mainGui.length > 0) {
            guiElements.item(0).removeChild(mainGui.item(0));
        }
    }
    const canvas = document.querySelector('canvas');
    if (canvas && canvas.parentNode) {
        document.body.removeChild(canvas.parentNode);
    }
    PARTICLES = effectController.numberOfStars;
    if (typeof init === 'function') {
        init(effectController.typeOfSimulation.toString());
    }
}

// ============ OPTIMIZATION 13: Performance Analysis & Monitoring ============
// Advanced performance analysis for playback optimization
function analyzePlaybackPerformance() {
    if (!window.playbackPerf) return;
    
    const perf = window.playbackPerf;
    const avgTime = perf.totalTime / perf.totalFrames;
    const avgFPS = 1000 / avgTime;
    const cacheHitRate = window.playbackCacheHits / (window.playbackCacheHits + window.playbackCacheMisses) * 100;
    
    console.log('🔍 ===== GALAXY PLAYBACK PERFORMANCE ANALYSIS =====');
    console.log(`📊 Total Frames Processed: ${perf.totalFrames}`);
    console.log(`⚡ Average Frame Time: ${avgTime.toFixed(2)}ms`);
    console.log(`🎯 Average FPS: ${avgFPS.toFixed(1)}`);
    console.log(`⏱️ Max Frame Time: ${perf.maxTime.toFixed(2)}ms`);
    console.log(`💾 Cache Hit Rate: ${cacheHitRate.toFixed(1)}%`);
    console.log(`🗂️ Cached Frames: ${window.playbackFrameBufferCache.size}`);
    console.log(`📈 Memory Pool Usage: ${window.playbackTextureArrayPool.length} arrays available`);
    
    // Performance recommendations
    if (avgFPS < 30) {
        console.log('⚠️ PERFORMANCE WARNING: Average FPS below 30. Consider:');
        console.log('   • Reducing particle count');
        console.log('   • Increasing cache size');
        console.log('   • Using level-of-detail optimization');
    } else if (avgFPS > 120) {
        console.log('🚀 EXCELLENT: Playback performance is optimal!');
    }
    
    if (cacheHitRate < 80) {
        console.log('💡 SUGGESTION: Low cache hit rate. Consider increasing MAX_CACHED_FRAMES.');
    }
    
    console.log('===============================================');
}

// Initialize performance tracking
window.playbackCacheHits = 0;
window.playbackCacheMisses = 0;

// ============ END OPTIMIZATION FUNCTIONS ============
// Handle selecting the SQL view from the main menu
function selectSQLView() {
    console.log('Opening SQL Database View...');
    hideMainMenu();
    
    // Set mode to SQL view (using mode 4)
    selectedChoice = 4;
    
    // Create SQL view interface
    createSQLViewInterface();
}

// Create the SQL query interface
function createSQLViewInterface() {
    // Create main container
    const sqlContainer = document.createElement('div');
    sqlContainer.id = 'sql-view-container';
    sqlContainer.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: #0a0a0a;
        color: white;
        font-family: 'Courier New', monospace;
        overflow: hidden;
        z-index: 1000;
    `;
    
    // Create header
    const header = document.createElement('div');
    header.style.cssText = `
        background: linear-gradient(45deg, #1a1a2e, #16213e);
        padding: 20px;
        border-bottom: 2px solid #4a9eff;
        display: flex;
        justify-content: space-between;
        align-items: center;
    `;
    header.innerHTML = `
        <h1 style="margin: 0; color: #4a9eff; font-size: 24px;">🗄️ Galaxy Simulation Database Query Interface</h1>
        <button id="backToMenuBtn" style="
            background: #666;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            font-weight: bold;
        ">← Back to Menu</button>
    `;
    
    // Create main content area
    const content = document.createElement('div');
    content.style.cssText = `
        display: flex;
        height: calc(100% - 84px);
    `;
    
    // Create sidebar for schema info
    const sidebar = document.createElement('div');
    sidebar.style.cssText = `
        width: 300px;
        background: #1a1a1a;
        border-right: 2px solid #333;
        padding: 20px;
        overflow-y: auto;
        flex-shrink: 0;
    `;
    sidebar.innerHTML = `
        <h3 style="color: #4a9eff; margin-top: 0;">Database Schema</h3>
        <div id="schema-info">Loading schema...</div>
        
        <h3 style="color: #4a9eff; margin-top: 30px;">Quick Queries</h3>
        <div id="quick-queries">
            <button class="quick-query-btn" data-query="SELECT COUNT(*) as total_snapshots FROM particle_snapshots;">Total Snapshots</button>
            <button class="quick-query-btn" data-query="SELECT COUNT(DISTINCT frame_number) as total_frames FROM particle_snapshots;">Total Frames</button>
            <button class="quick-query-btn" data-query="SELECT MIN(frame_number) as min_frame, MAX(frame_number) as max_frame FROM particle_snapshots;">Frame Range</button>
            <button class="quick-query-btn" data-query="SELECT frame_number, COUNT(*) as particle_count FROM particle_snapshots GROUP BY frame_number ORDER BY frame_number LIMIT 10;">Particles per Frame</button>
            <button class="quick-query-btn" data-query="SELECT * FROM particle_snapshots ORDER BY created_at DESC LIMIT 100;">Recent Snapshots</button>
        </div>
    `;
    
    // Create main query area
    const queryArea = document.createElement('div');
    queryArea.style.cssText = `
        flex: 1;
        display: flex;
        flex-direction: column;
        padding: 20px;
    `;
    
    // Create query input area
    const queryInput = document.createElement('div');
    queryInput.style.cssText = `
        margin-bottom: 20px;
    `;
    queryInput.innerHTML = `
        <h3 style="color: #4a9eff; margin-top: 0;">SQL Query</h3>
        <textarea id="sql-query" placeholder="Enter your SELECT query here..." style="
            width: 100%;
            height: 120px;
            background: #2a2a2a;
            color: white;
            border: 2px solid #333;
            border-radius: 5px;
            padding: 10px;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            resize: vertical;
        "></textarea>
        <div style="margin-top: 10px;">
            <button id="execute-query-btn" style="
                background: #4a9eff;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 5px;
                cursor: pointer;
                font-weight: bold;
                margin-right: 10px;
            ">Execute Query</button>
            <button id="clear-query-btn" style="
                background: #666;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 5px;
                cursor: pointer;
            ">Clear</button>
            <span id="query-status" style="margin-left: 20px; color: #888;"></span>
        </div>
    `;
    
    // Create results area
    const resultsArea = document.createElement('div');
    resultsArea.style.cssText = `
        flex: 1;
        display: flex;
        flex-direction: column;
    `;
    resultsArea.innerHTML = `
        <h3 style="color: #4a9eff; margin-top: 0; margin-bottom: 10px;">Query Results</h3>
        <div id="results-container" style="
            flex: 1;
            background: #1a1a1a;
            border: 2px solid #333;
            border-radius: 5px;
            overflow: auto;
            position: relative;
        ">
            <div id="results-placeholder" style="
                padding: 40px;
                text-align: center;
                color: #666;
                font-style: italic;
            ">No query executed yet. Enter a SELECT query above and click Execute.</div>
        </div>
    `;
    
    // Assemble the interface
    content.appendChild(sidebar);
    content.appendChild(queryArea);
    queryArea.appendChild(queryInput);
    queryArea.appendChild(resultsArea);
    
    sqlContainer.appendChild(header);
    sqlContainer.appendChild(content);
    document.body.appendChild(sqlContainer);
    
    // Add CSS for quick query buttons
    const style = document.createElement('style');
    style.textContent = `
        .quick-query-btn {
            display: block;
            width: 100%;
            margin-bottom: 8px;
            padding: 8px 12px;
            background: #333;
            color: white;
            border: 1px solid #555;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            text-align: left;
            transition: background 0.2s;
        }
        .quick-query-btn:hover {
            background: #444;
        }
        
        .results-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
        }
        .results-table th,
        .results-table td {
            padding: 8px 12px;
            text-align: left;
            border-bottom: 1px solid #333;
            max-width: 200px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .results-table th {
            background: #2a2a2a;
            color: #4a9eff;
            font-weight: bold;
            position: sticky;
            top: 0;
            z-index: 10;
        }
        .results-table tr:hover {
            background: #222;
        }
        .results-table td {
            color: #ddd;
        }
    `;
    document.head.appendChild(style);
    
    // Set up event listeners
    setupSQLViewEventListeners();
    
    // Load schema information
    loadDatabaseSchema();
}

// Set up event listeners for the SQL view
function setupSQLViewEventListeners() {
    // Back to menu button
    document.getElementById('backToMenuBtn').addEventListener('click', () => {
        document.getElementById('sql-view-container').remove();
        showMainMenu();
    });
    
    // Execute query button
    document.getElementById('execute-query-btn').addEventListener('click', () => {
        const query = document.getElementById('sql-query').value.trim();
        if (query) {
            executeQuery(query);
        }
    });
    
    // Clear query button
    document.getElementById('clear-query-btn').addEventListener('click', () => {
        document.getElementById('sql-query').value = '';
        document.getElementById('query-status').textContent = '';
    });
    
    // Quick query buttons
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('quick-query-btn')) {
            const query = e.target.getAttribute('data-query');
            document.getElementById('sql-query').value = query;
            executeQuery(query);
        }
    });
    
    // Enter key in textarea
    document.getElementById('sql-query').addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') {
            const query = e.target.value.trim();
            if (query) {
                executeQuery(query);
            }
        }
    });
}

// Load database schema information
async function loadDatabaseSchema() {
    try {
        const response = await fetch('http://localhost:3001/sql/schema');
        const data = await response.json();
        
        if (data.success) {
            displaySchema(data.tables);
        } else {
            document.getElementById('schema-info').innerHTML = `
                <div style="color: #ff6b6b;">Error loading schema: ${data.error}</div>
            `;
        }
    } catch (error) {
        document.getElementById('schema-info').innerHTML = `
            <div style="color: #ff6b6b;">Failed to connect to database: ${error.message}</div>
        `;
    }
}

// Display schema information
function displaySchema(tables) {
    const schemaContainer = document.getElementById('schema-info');
    let html = '';
    
    for (const [tableName, tableInfo] of Object.entries(tables)) {
        html += `
            <div style="margin-bottom: 20px;">
                <h4 style="color: #51cf66; margin: 0 0 8px 0;">${tableName}</h4>
                <div style="font-size: 11px; color: #888; margin-bottom: 8px;">${tableInfo.type}</div>
        `;
        
        for (const column of tableInfo.columns) {
            const nullable = column.is_nullable === 'YES' ? '?' : '!';
            html += `
                <div style="margin-left: 10px; font-size: 11px; color: #ccc;">
                    <span style="color: #ffd93d;">${column.column_name}</span>
                    <span style="color: #74c0fc;">${column.data_type}</span>
                    <span style="color: #888;">${nullable}</span>
                </div>
            `;
        }
        
        html += '</div>';
    }
    
    schemaContainer.innerHTML = html;
}

// Execute a SQL query
async function executeQuery(query) {
    const statusElement = document.getElementById('query-status');
    const resultsContainer = document.getElementById('results-container');
    const executeBtn = document.getElementById('execute-query-btn');
    
    // Update UI to show loading state
    statusElement.textContent = 'Executing...';
    statusElement.style.color = '#ffd93d';
    executeBtn.disabled = true;
    executeBtn.textContent = 'Executing...';
    
    try {
        const response = await fetch('http://localhost:3001/sql/query', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query })
        });
        
        const data = await response.json();
        
        if (data.success) {
            displayQueryResults(data);
            statusElement.textContent = `✅ Query executed in ${data.executionTime}ms - ${data.rowCount} rows returned`;
            statusElement.style.color = '#51cf66';
        } else {
            displayQueryError(data.error, data.hint);
            statusElement.textContent = `❌ Query failed: ${data.error}`;
            statusElement.style.color = '#ff6b6b';
        }
    } catch (error) {
        displayQueryError(`Network error: ${error.message}`);
        statusElement.textContent = `❌ Connection failed: ${error.message}`;
        statusElement.style.color = '#ff6b6b';
    } finally {
        // Reset button state
        executeBtn.disabled = false;
        executeBtn.textContent = 'Execute Query';
    }
}

// Display query results in a table
function displayQueryResults(data) {
    const resultsContainer = document.getElementById('results-container');
    
    if (data.rows.length === 0) {
        resultsContainer.innerHTML = `
            <div style="padding: 40px; text-align: center; color: #888;">
                Query executed successfully but returned no results.
            </div>
        `;
        return;
    }
    
    // Create table
    let html = '<table class="results-table"><thead><tr>';
    
    // Add headers
    for (const field of data.fields) {
        html += `<th>${field}</th>`;
    }
    html += '</tr></thead><tbody>';
    
    // Add rows
    for (const row of data.rows) {
        html += '<tr>';
        for (const field of data.fields) {
            let value = row[field];
            if (value === null) {
                value = '<span style="color: #666; font-style: italic;">NULL</span>';
            } else if (typeof value === 'number') {
                value = value.toLocaleString();
            } else if (typeof value === 'string' && value.length > 50) {
                value = value.substring(0, 47) + '...';
            }
            html += `<td>${value}</td>`;
        }
        html += '</tr>';
    }
    
    html += '</tbody></table>';
    resultsContainer.innerHTML = html;
}

// Display query error
function displayQueryError(error, hint = null) {
    const resultsContainer = document.getElementById('results-container');
    
    let html = `
        <div style="padding: 20px;">
            <div style="color: #ff6b6b; font-weight: bold; margin-bottom: 10px;">
                ❌ Query Error
            </div>
            <div style="color: #ddd; margin-bottom: 15px; font-family: monospace; background: #2a1a1a; padding: 10px; border-radius: 3px;">
                ${error}
            </div>
    `;
    
    if (hint) {
        html += `
            <div style="color: #ffd93d; font-weight: bold; margin-bottom: 5px;">
                💡 Hint:
            </div>
            <div style="color: #ddd; font-family: monospace; background: #1a1a2a; padding: 10px; border-radius: 3px;">
                ${hint}
            </div>
        `;
    }
    
    html += '</div>';
    resultsContainer.innerHTML = html;
}