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
// let frameSkipCounter = 0; // Not used in final combined version
// let skipEveryOtherFrame = false; // Not used

let gpuCompute;
let velocityVariable;
let positionVariable;
let velocityUniforms;
let particleUniforms;
let effectController;
let particles;
let material;
let controls;
// let luminosity; // luminosity is part of effectController
let paused = false;
let autoRotation = false;
let bloom = { strength: 0.7};
let bloomPass;
// motion blur
let renderTargetParameters;
let savePass;
let blendPass;

let enableDatabaseLogging = true; // ADDED: Global flag for database logging
let loggingDialog = null; // ADDED: Reference to the logging preference dialog

// Controls how often to collect and send particle data to the backend database
let snapshotFrameInterval = 2;

/*--------------------------INITIALISATION PARAMETERS (from old code for reference)-----------------------------------------------*/
const gravity_const = 20;
const interactionRate_const = 1.0;
const timeStep_const = 0.001;
const blackHoleForce_const = 100.0;
const constLuminosity_const = 1.0;
const numberOfStars_const = 30000;
const radius_const = 100;
const height_const = 5;
const middleVelocity_const = 2;
const velocity_const = 15;
const typeOfSimulation_const = { "Galaxie": 1, "Univers": 2, "Collision de galaxies": 3 };

renderTargetParameters = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    stencilBuffer: false
};

savePass = new SavePass(new THREE.WebGLRenderTarget(window.innerWidth,window.innerHeight,renderTargetParameters));
blendPass = new ShaderPass(BlendShader, "tDiffuse1");
blendPass.uniforms["tDiffuse2"].value = savePass.renderTarget.texture;
blendPass.uniforms["mixRatio"].value = 0.5;
const outputPass = new ShaderPass(CopyShader);
outputPass.renderToScreen = true;

effectController = {
    gravity: 225.0, interactionRate: 0.05, timeStep: 0.0001, blackHoleForce: 100.0, luminosity: 0.25,
    maxAccelerationColor: 2.0, maxAccelerationColorPercent: 20, motionBlur: false, hideDarkMatter: false,
    numberOfStars: 100000, radius: 2, height: 5, middleVelocity: 2, velocity: 15,
    typeOfSimulation: 2, autoRotation: false
};

let PARTICLES = effectController.numberOfStars;
let selectedChoice = 1;

function sendInitialParticlesToBackend_Sync(posArray, velArray) {
    if (!enableDatabaseLogging) { // MODIFIED: Check flag
        console.log('Database logging disabled. Skipping initial particle send.');
        return;
    }
    const particlesData = [];
    for (let k = 0, kl = posArray.length; k < kl; k += 4) {
        particlesData.push({ x: posArray[k], y: posArray[k+1], z: posArray[k+2], vx: velArray[k], vy: velArray[k+1], vz: velArray[k+2] });
    }
    fetch('http://localhost:3001/particles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(particlesData)
    }).then(res => {
        if (res.ok) console.log('Initial particles sent to backend (sync).');
        else console.error('Failed to send initial particles to backend (sync).');
    }).catch(console.error);
}

function fillTextures( texturePosition, textureVelocity ) {
    const posArray = texturePosition.image.data; const velArray = textureVelocity.image.data;
    const radius = effectController.radius; const height = effectController.height;
    const middleVelocity = effectController.middleVelocity; const maxVel = effectController.velocity;
    for ( let k = 0, kl = posArray.length; k < kl; k += 4 ) {
        let x, z, rr, y, vx, vy, vz;
        if (k === 0){ x = 0; z = 0; y = 0; rr = 0; }
        else {
            do { x = ( Math.random()*2-1 ); z = ( Math.random()*2-1 ); rr = x*x+z*z; } while ( rr > 1 );
            rr = Math.sqrt(rr); const rExp = radius * Math.pow(rr, middleVelocity);
            const vel = maxVel * Math.pow(rr, 0.2);
            vx = vel*z + (Math.random()*2-1)*0.001; vy = (Math.random()*2-1)*0.001*0.05; vz = -vel*x + (Math.random()*2-1)*0.001;
            x *= rExp; z *= rExp; y = (Math.random()*2-1)*height;
        }
        posArray[k+0]=x; posArray[k+1]=y; posArray[k+2]=z; posArray[k+3]=(k > 0.85*(posArray.length/4))?1:0;
        velArray[k+0]=vx; velArray[k+1]=vy; velArray[k+2]=vz; velArray[k+3]=0;
    }
    sendInitialParticlesToBackend_Sync(posArray, velArray);
}

function fillUniverseTextures_Sync( texturePosition, textureVelocity ) {
    const posArray = texturePosition.image.data; const velArray = textureVelocity.image.data;
    const radius = effectController.radius; let pulseScale = (selectedChoice === 1)?3.18:5; // Depends on current main choice
    for ( let k = 0, kl = posArray.length; k < kl; k += 4 ) {
        let x,y,z; do { x=(Math.random()*2-1); y=(Math.random()*2-1); z=(Math.random()*2-1); } while (x*x+y*y+z*z > 1);
        x*=radius; y*=radius; z*=radius;
        const vx=pulseScale*x; const vy=pulseScale*y; const vz=pulseScale*z;
        posArray[k+0]=x; posArray[k+1]=y; posArray[k+2]=z; posArray[k+3]=(k > 0.85*(posArray.length/4))?1:0;
        velArray[k+0]=vx; velArray[k+1]=vy; velArray[k+2]=vz; velArray[k+3]=0;
    }
    sendInitialParticlesToBackend_Sync(posArray, velArray);
}

function fillGalaxiesCollisionTextures( texturePosition, textureVelocity ){
    const posArray = texturePosition.image.data; const velArray = textureVelocity.image.data;
    const radius=effectController.radius; const height=effectController.height; const middleVelocity=effectController.middleVelocity; const maxVel=effectController.velocity;
    let indice=0;
    for(let k=0,kl=posArray.length; k<kl; k+=4){
        let x,z,rr,y,vx,vy,vz;
        if(indice%2===0){
            do{x=(Math.random()*2-1);z=(Math.random()*2-1);rr=x*x+z*z;}while(rr>1);
            rr=Math.sqrt(rr);const rExp=radius*Math.pow(rr,middleVelocity);const vel=maxVel*Math.pow(rr,0.2);
            vx=vel*z+(Math.random()*2-1)*0.001;vy=(Math.random()*2-1)*0.001*0.05;vz=-vel*x+(Math.random()*2-1)*0.001;
            x*=rExp;z*=rExp;y=(Math.random()*2-1)*height;
        }else{
            do{x=(Math.random()*2-1);y=(Math.random()*2-1);rr=x*x+y*y;}while(rr>1);
            rr=Math.sqrt(rr);const rExp=radius*Math.pow(rr,middleVelocity);const vel=maxVel*Math.pow(rr,0.2);
            vx=-vel*y+(Math.random()*2-1)*0.001;vy=vel*x+(Math.random()*2-1)*0.001;vz=-(Math.random()*2-1)*0.001*0.05;
            const angle=-Math.PI/4;let vy_temp=vy,vz_temp=vz;vy=vy_temp*Math.cos(angle)-vz_temp*Math.sin(angle);vz=vy_temp*Math.sin(angle)+vz_temp*Math.cos(angle);
            x=x*rExp+200;y=y*rExp+200;z=(Math.random()*2-1)*height+10;
            let y_temp=y,z_temp_gal2=z;y=y_temp*Math.cos(angle)-z_temp_gal2*Math.sin(angle);z=y_temp*Math.sin(angle)+z_temp_gal2*Math.cos(angle);
        }
        posArray[k+0]=x;posArray[k+1]=y;posArray[k+2]=z;posArray[k+3]=(k > 0.85*(posArray.length/4))?1:0;
        velArray[k+0]=vx;velArray[k+1]=vy;velArray[k+2]=vz;velArray[k+3]=0;indice++;
    }
    sendInitialParticlesToBackend_Sync(posArray,velArray);
}

function initComputeRenderer(typeOfSimulation) {
    let textureSize = Math.round(Math.sqrt(effectController.numberOfStars));
    gpuCompute = new GPUComputationRenderer(textureSize,textureSize,renderer);
    if(renderer.capabilities.isWebGL2===false) gpuCompute.setDataType(THREE.HalfFloatType);
    const dtPosition=gpuCompute.createTexture(); const dtVelocity=gpuCompute.createTexture();
    if(typeOfSimulation==="1") fillTextures(dtPosition,dtVelocity);
    else if(typeOfSimulation==="2") fillUniverseTextures_Sync(dtPosition,dtVelocity);
    else if(typeOfSimulation==="3") fillGalaxiesCollisionTextures(dtPosition,dtVelocity);
    velocityVariable=gpuCompute.addVariable('textureVelocity',computeShaderVelocity,dtVelocity);
    positionVariable=gpuCompute.addVariable('texturePosition',computeShaderPosition,dtPosition);
    gpuCompute.setVariableDependencies(velocityVariable,[positionVariable,velocityVariable]);
    gpuCompute.setVariableDependencies(positionVariable,[positionVariable,velocityVariable]);
    velocityUniforms=velocityVariable.material.uniforms;
    Object.assign(velocityUniforms, { 'gravity':{value:0.0}, 'interactionRate':{value:0.0}, 'timeStep':{value:0.0}, 'uMaxAccelerationColor':{value:0.0}, 'blackHoleForce':{value:0.0}, 'luminosity':{value:0.0} });
    const error=gpuCompute.init(); if(error!==null) console.error(error);
}

function initParticles(typeOfSimulation) {
    console.log('Number of particles for GPU:', PARTICLES);
    geometry=new THREE.BufferGeometry();
    const positions=new Float32Array(PARTICLES*3); const uvs=new Float32Array(PARTICLES*2);
    let matrixSize=Math.sqrt(PARTICLES); let p=0;
    for(let j=0;j<matrixSize;j++){ for(let i=0;i<matrixSize;i++){ uvs[p++]=i/(matrixSize-1); uvs[p++]=j/(matrixSize-1); }}
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));
    particleUniforms={
        'texturePosition':{value:null}, 'textureVelocity':{value:null},
        'cameraConstant':{value:getCameraConstant(camera)}, 'particlesCount':{value:PARTICLES},
        'uMaxAccelerationColor':{value:effectController.maxAccelerationColor},
        'uLuminosity':{value:effectController.luminosity},
        'uHideDarkMatter':{value:effectController.hideDarkMatter},
    };
    material=new THREE.ShaderMaterial({ depthWrite:false, blending:THREE.AdditiveBlending, vertexColors:true, uniforms:particleUniforms, vertexShader:galaxyVortexShader, fragmentShader:galaxyFragmentShader });
    particles=new THREE.Points(geometry,material); particles.frustumCulled=false; scene.add(particles);
}

function getCameraConstant(camera){ return window.innerHeight/(Math.tan(THREE.MathUtils.DEG2RAD*0.5*camera.fov)/camera.zoom); }

function onWindowResize(){
    if(!camera||!renderer)return;
    camera.aspect=window.innerWidth/window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth,window.innerHeight);
    if(particleUniforms)particleUniforms['cameraConstant'].value=getCameraConstant(camera);
    if(composer)composer.setSize(window.innerWidth,window.innerHeight);
    if(savePass)savePass.renderTarget.setSize(window.innerWidth,window.innerHeight);
}

function dynamicValuesChanger(){
    if(!velocityUniforms)return;
    velocityUniforms['gravity'].value=effectController.gravity;
    velocityUniforms['interactionRate'].value=effectController.interactionRate;
    velocityUniforms['timeStep'].value=effectController.timeStep;
    velocityUniforms['uMaxAccelerationColor'].value=effectController.maxAccelerationColor;
    velocityUniforms['blackHoleForce'].value=effectController.blackHoleForce;
    velocityUniforms['luminosity'].value=effectController.luminosity;
    if(material&&material.uniforms.uLuminosity)material.uniforms.uLuminosity.value=effectController.luminosity;
    if(material&&material.uniforms.uHideDarkMatter)material.uniforms.uHideDarkMatter.value=effectController.hideDarkMatter;
}

function initGUI(){
    const gui=new GUI({width:350});
    const folder1=gui.addFolder('Dynamic Parameters'); const folderGraphicSettings=gui.addFolder('Graphics settings'); const folder2=gui.addFolder('Static parameters (need restart)');
    folder1.add(effectController,'gravity',0.0,1000.0,0.05).onChange(dynamicValuesChanger).name("Gravitational force");
    folder1.add(effectController,'interactionRate',0.0,1.0,0.001).onChange(dynamicValuesChanger).name("Interaction rate (%)");
    folder1.add(effectController,'timeStep',0.0,0.01,0.0001).onChange(dynamicValuesChanger).name("Time step");
    folder1.add(effectController,'hideDarkMatter').onChange(dynamicValuesChanger).name("Hide dark matter");
    folderGraphicSettings.add(bloom,'strength',0.0,2.0,0.1).onChange(value=>{bloom.strength=value;if(bloomPass)bloomPass.strength=bloom.strength;}).name("Bloom");
    folderGraphicSettings.add(effectController,'motionBlur').name("Motion blur");
    if(effectController.typeOfSimulation===1||effectController.typeOfSimulation===3){
        folder1.add(effectController,'blackHoleForce',0.0,10000.0,1.0).onChange(dynamicValuesChanger).name("Black hole mass");
        folderGraphicSettings.add(effectController,'maxAccelerationColorPercent',0.01,100,0.01).onChange(value=>{effectController.maxAccelerationColor=value*10;dynamicValuesChanger();}).name("Colors mix (%)");
        folder2.add(effectController,'numberOfStars',2.0,1000000.0,1.0).name("Number of stars");
        folder2.add(effectController,'radius',1.0,1000.0,1.0).name("Galaxy diameter");
        folder2.add(effectController,'height',0.0,50.0,0.01).name("Galaxy height");
        folder2.add(effectController,'middleVelocity',0.0,20.0,0.001).name("Center rotation speed");
        folder2.add(effectController,'velocity',0.0,150.0,0.1).name("Initial rotation speed");
    }else if(effectController.typeOfSimulation===2){
        folderGraphicSettings.add(effectController,'luminosity',0.0,1.0,0.0001).onChange(dynamicValuesChanger).name("Luminosity");
        folderGraphicSettings.add(effectController,'maxAccelerationColorPercent',0.01,100,0.01).onChange(value=>{effectController.maxAccelerationColor=value/10;dynamicValuesChanger();}).name("Colors mix (%)");
        folder2.add(effectController,'numberOfStars',2.0,10000000.0,1.0).name("Number of galaxies");
        folder2.add(effectController,'radius',1.0,1000.0,1.0).name("Initial universe diameter");
        folder2.add(effectController,'autoRotation').name('Auto-rotation').listen().onChange(()=>{autoRotation=!autoRotation;if(controls)controls.autoRotate=autoRotation;});
    }
    const btnRestart={restartSimulation:()=>{restartSimulation();}}; const btnReset={resetParameters:()=>{resetParameters();}}; const btnPause={pauseSimulation:()=>{}};
    folder2.add(effectController,'typeOfSimulation',typeOfSimulation_const).onChange(switchSimulation).name("Type of simulation");
    folder2.add(btnRestart,'restartSimulation').name("Restart simulation");
    folder2.add(btnReset,'resetParameters').name("Reset parameters");
    let btnPauseCtrl=folder2.add(btnPause,'pauseSimulation').name(paused?"Resume":"Pause");
    btnPauseCtrl.onChange(()=>{paused=!paused;btnPauseCtrl.name(paused?"Resume":"Pause");});
    folder1.open();folder2.open();folderGraphicSettings.open();
}

function switchSimulation(){
    paused=false; const isNormalMode=selectedChoice===1; let config={};
    switch(effectController.typeOfSimulation.toString()){
        case "1": config={gravity:gravity_const,interactionRate:isNormalMode?0.5:interactionRate_const,timeStep:timeStep_const,blackHoleForce:blackHoleForce_const,luminosity:constLuminosity_const,maxAccelerationColor:isNormalMode?4.0:50.0,maxAccelerationColorPercent:isNormalMode?0.4:5.0,motionBlur:false,hideDarkMatter:false,numberOfStars:isNormalMode?10000:numberOfStars_const,radius:isNormalMode?50:radius_const,height:height_const,middleVelocity:middleVelocity_const,velocity:isNormalMode?7:velocity_const,typeOfSimulation:1,autoRotation:false,bloomStrength:1.0}; break;
        case "2": config={gravity:isNormalMode?225.0:20.0,interactionRate:0.05,timeStep:0.0001,blackHoleForce:100.0,luminosity:0.25,maxAccelerationColor:2.0,maxAccelerationColorPercent:20,motionBlur:false,hideDarkMatter:false,numberOfStars:isNormalMode?100000:1000000,radius:2,height:5,middleVelocity:2,velocity:15,typeOfSimulation:2,autoRotation:false,bloomStrength:0.7}; break;
        case "3": config={gravity:isNormalMode?40:gravity_const,interactionRate:isNormalMode?0.5:interactionRate_const,timeStep:timeStep_const,blackHoleForce:blackHoleForce_const,luminosity:constLuminosity_const,maxAccelerationColor:isNormalMode?15.0:19.0,maxAccelerationColorPercent:isNormalMode?1.5:1.9,motionBlur:false,hideDarkMatter:false,numberOfStars:isNormalMode?10000:numberOfStars_const,radius:isNormalMode?50:radius_const,height:height_const,middleVelocity:middleVelocity_const,velocity:isNormalMode?7:12,typeOfSimulation:3,autoRotation:false,bloomStrength:1.0}; break;
        default: return;
    }
    Object.assign(effectController,config); bloom.strength=config.bloomStrength;
    restartSimulation();
}

function resetParameters(){ switchSimulation(); }

function init(typeOfSimulationString) {
    effectController.typeOfSimulation=parseInt(typeOfSimulationString,10); PARTICLES=effectController.numberOfStars;
    container=document.createElement('div'); document.body.appendChild(container);
    camera=new THREE.PerspectiveCamera(75,window.innerWidth/window.innerHeight,0.01,1e20);
    camera.position.set(15,112,168);
    if(effectController.typeOfSimulation===3) camera.position.set(15,456,504);
    if(selectedChoice===1&&effectController.typeOfSimulation===2) camera.position.set(15,456,504);
    scene=new THREE.Scene(); scene.background=new THREE.Color(0x000000);
    renderer=new THREE.WebGLRenderer({antialias:true}); renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth,window.innerHeight); renderer.setClearColor(0x000000); container.appendChild(renderer.domElement);
    controls=new OrbitControls(camera,renderer.domElement);
    Object.assign(controls,{enableDamping:true,dampingFactor:0.05,enableZoom:true,autoRotate:effectController.autoRotation});
    if(effectController.typeOfSimulation===2&&controls.autoRotate) controls.autoRotateSpeed=-1.0;
    initComputeRenderer(typeOfSimulationString);
    stats=new Stats(); Object.assign(stats.domElement.style,{position:'absolute',top:'0px',left:'0px'}); container.appendChild(stats.dom);
    window.addEventListener('resize',onWindowResize,false);
    initGUI(); initParticles(typeOfSimulationString); dynamicValuesChanger();
    const renderScene=new RenderPass(scene,camera);
    bloomPass=new UnrealBloomPass(new THREE.Vector2(window.innerWidth,window.innerHeight),0,0,0); bloomPass.strength=bloom.strength;
    composer=new EffectComposer(renderer); composer.addPass(renderScene); composer.addPass(bloomPass);
    primeSimulation();
}

function hideMainMenu(){ const mc=document.getElementById('main-container'); if(mc)mc.remove(); }

let playbackConfig={startFrame:0,endFrame:1000,frameSkip:1,totalFramesToDownload:1000};
function selectReplayMode(){ console.log('Entering replay mode...'); hideMainMenu(); selectedChoice=3; showPlaybackConfigDialog(); }

function showPlaybackConfigDialog(){
    const modal=document.createElement('div');modal.className='playback-config-modal';modal.style.cssText=`position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);display:flex;justify-content:center;align-items:center;z-index:10000;`;
    const dialog=document.createElement('div');dialog.style.cssText=`background:#1a1a1a;padding:30px;border-radius:10px;border:2px solid #4a9eff;color:white;font-family:'Courier New',monospace;max-width:500px;width:90%;`;
    dialog.innerHTML=`<h2 style="color:#4a9eff;margin-top:0;">Playback Config</h2><div><label>Start Frame:</label><input type="number" id="startFrameInput" value="${playbackConfig.startFrame}" min="0"></div><div><label>End Frame:</label><input type="number" id="endFrameInput" value="${playbackConfig.endFrame}" min="1"></div><div><label>Frame Skip:</label><input type="number" id="frameSkipInput" value="${playbackConfig.frameSkip}" min="1" max="10"></div><div><small>Total frames: <span id="totalFramesCalc">${Math.ceil((playbackConfig.endFrame-playbackConfig.startFrame)/playbackConfig.frameSkip)}</span></small></div><div><button id="startPlaybackBtn">Start</button><button id="cancelPlaybackBtn">Cancel</button></div>`;
    ['startFrameInput','endFrameInput','frameSkipInput'].forEach(id => { const el = dialog.querySelector(`#${id}`); if(el) el.style.cssText = `width:95%;padding:8px;border-radius:4px;border:1px solid #4a9eff;background:#2a2a2a;color:white;margin-bottom:10px;`;});
    dialog.querySelectorAll('button').forEach(btn => btn.style.cssText = `padding:12px;background:#4a9eff;color:white;border:none;border-radius:4px;cursor:pointer;font-weight:bold;margin:10px 5px 0 5px;flex:1;`);
    dialog.querySelector('#cancelPlaybackBtn').style.background = '#666';
    modal.appendChild(dialog);document.body.appendChild(modal);
    function updateTotalFrames(){const s=parseInt(dialog.querySelector('#startFrameInput').value)||0,e=parseInt(dialog.querySelector('#endFrameInput').value)||1000,sk=parseInt(dialog.querySelector('#frameSkipInput').value)||1;dialog.querySelector('#totalFramesCalc').textContent=Math.ceil(Math.max(0,e-s)/sk);}
    ['startFrameInput','endFrameInput','frameSkipInput'].forEach(id=>dialog.querySelector(`#${id}`).addEventListener('input',updateTotalFrames));
    dialog.querySelector('#startPlaybackBtn').addEventListener('click',()=>{const sF=parseInt(dialog.querySelector('#startFrameInput').value)||0,eF=parseInt(dialog.querySelector('#endFrameInput').value)||1000,fS=parseInt(dialog.querySelector('#frameSkipInput').value)||1;if(sF<0||eF<=sF||fS<1||fS>10){alert('Invalid inputs.');return;}Object.assign(playbackConfig,{startFrame:sF,endFrame:eF,frameSkip:fS,totalFramesToDownload:Math.ceil((eF-sF)/fS)});document.body.removeChild(modal);startPlaybackWithConfig();});
    dialog.querySelector('#cancelPlaybackBtn').addEventListener('click',()=>{document.body.removeChild(modal);showMainMenu();});
}

function startPlaybackWithConfig(){
    console.log('Playback config:',playbackConfig);initReplayScene();
    if(!animationFrameId)animate();showLoadingMessage(`Downloading ${playbackConfig.totalFramesToDownload} frames...`);
    const url=`http://localhost:3001/playback/export?start=${playbackConfig.startFrame}&end=${playbackConfig.endFrame}&skip=${playbackConfig.frameSkip}`;
    tryFetchPlaybackData(url,true);
}
function initReplayScene(){
    console.log('Init replay scene...'); if(!scene)scene=new THREE.Scene();scene.background=new THREE.Color(0x000000);
    if(!camera){camera=new THREE.PerspectiveCamera(75,window.innerWidth/window.innerHeight,0.1,10000);camera.position.set(0,0,100);camera.lookAt(0,0,0);}
    if(!renderer){renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(window.innerWidth,window.innerHeight);renderer.setClearColor(0x000000);document.body.appendChild(renderer.domElement);}
    if(!controls){controls=new OrbitControls(camera,renderer.domElement);Object.assign(controls,{enableDamping:true,dampingFactor:0.05,enableZoom:true,autoRotate:false});}
    if(!stats){stats=new Stats();Object.assign(stats.domElement.style,{position:'absolute',top:'0px',left:'0px'});document.body.appendChild(stats.domElement);}
}
function tryFetchPlaybackData(url,canRetry=true){
    fetch(url).then(r=>{if(!r.ok)throw new Error(`Network error: ${r.status}`);return r.arrayBuffer();})
    .then(ab=>{console.log('Playback data size:',ab.byteLength);hideLoadingMessage();preparePlaybackSimulation(ab);})
    .catch(e=>{console.error('Fetch error:',e);if(canRetry){const fbUrl=`http://127.0.0.1:3001/playback/export?start=${playbackConfig.startFrame}&end=${playbackConfig.endFrame}&skip=${playbackConfig.frameSkip}`;tryFetchPlaybackData(fbUrl,false);}else{hideLoadingMessage();alert('Failed to fetch data.');restartSimulation();showMainMenu();}});
}
let playbackData=null,playbackFrames={},playbackFrameNumbers=[],currentPlaybackFrame=0,isPlaying=false,playbackInterval=null,playbackSpeed=30;
function preparePlaybackSimulation(arrayBuffer){
    const floatsPerRow=8;playbackData=new Float32Array(arrayBuffer);playbackFrames={};let maxParticleIndex=0;
    for(let i=0;i<playbackData.length;i+=floatsPerRow){const fN=playbackData[i],pI=playbackData[i+1];if(!playbackFrames[fN])playbackFrames[fN]=[];playbackFrames[fN].push({particle_index:pI,x:playbackData[i+2],y:playbackData[i+3],z:playbackData[i+4],vx:playbackData[i+5],vy:playbackData[i+6],vz:playbackData[i+7]});maxParticleIndex=Math.max(maxParticleIndex,pI);}
    playbackFrameNumbers=Object.keys(playbackFrames).map(Number).sort((a,b)=>a-b);
    console.log('Frames:',playbackFrameNumbers.length,'Max particle index:',maxParticleIndex);paused=true;
    setupReplayParticleSystem(maxParticleIndex+1);
    if(camera){camera.position.set(0,0,100);camera.lookAt(0,0,0);if(controls)controls.update();}
    createPlaybackControls();showPlaybackFrame(0);togglePlayback();
}
function setupReplayParticleSystem(particleCount){
    if(particles&&scene)scene.remove(particles);if(material)material.dispose();if(geometry)geometry.dispose();
    geometry=new THREE.BufferGeometry();const pos=new Float32Array(particleCount*3).fill(0);const clrs=new Float32Array(particleCount*3).fill(1.0);
    geometry.setAttribute('position',new THREE.BufferAttribute(pos,3));geometry.setAttribute('color',new THREE.BufferAttribute(clrs,3));
    material=new THREE.PointsMaterial({size:1.5,sizeAttenuation:true,vertexColors:true,transparent:true,opacity:0.8});
    particles=new THREE.Points(geometry,material);if(scene)scene.add(particles);else console.error("No scene for replay particles");
}
function createPlaybackControls(){
    if(document.getElementById('playbackControls'))document.getElementById('playbackControls').remove();
    const ctrlDiv=document.createElement('div');ctrlDiv.id='playbackControls';ctrlDiv.style.cssText=`position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.7);padding:10px;border-radius:8px;z-index:10001;display:flex;flex-direction:column;align-items:center;`;
    ctrlDiv.innerHTML=`<div style="display:flex;margin-bottom:10px;gap:5px;"><button id="playPauseBtn">Pause</button><button id="backBtn">◀◀</button><button id="stepBackBtn">◀</button><button id="stepForwardBtn">▶</button><button id="fwdBtn">▶▶</button><button id="menuBtnReplay">Menu</button></div><div style="width:300px;text-align:center;"><div class="progress-bar" style="background:#555;border-radius:5px;height:10px;position:relative;cursor:pointer;margin-bottom:5px;"><div id="progressFill" style="background:#4a9eff;height:100%;border-radius:5px;width:0%;"></div><div id="progressHandle" style="position:absolute;top:-3px;left:0%;width:16px;height:16px;background:white;border-radius:50%;transform:translateX(-50%);cursor:grab;"></div></div><div id="frameInfo" style="color:white;font-size:12px;">Frame: 0/0</div></div>`;
    document.body.appendChild(ctrlDiv);
    ctrlDiv.querySelector('#playPauseBtn').addEventListener('click',togglePlayback);
    ctrlDiv.querySelector('#backBtn').addEventListener('click',()=>showPlaybackFrame(Math.max(0,currentPlaybackFrame-10)));
    ctrlDiv.querySelector('#stepBackBtn').addEventListener('click',()=>showPlaybackFrame(Math.max(0,currentPlaybackFrame-1)));
    ctrlDiv.querySelector('#stepForwardBtn').addEventListener('click',()=>showPlaybackFrame(Math.min(playbackFrameNumbers.length-1,currentPlaybackFrame+1)));
    ctrlDiv.querySelector('#fwdBtn').addEventListener('click',()=>showPlaybackFrame(Math.min(playbackFrameNumbers.length-1,currentPlaybackFrame+10)));
    ctrlDiv.querySelector('#menuBtnReplay').addEventListener('click',()=>{stopPlayback();if(document.getElementById('playbackControls'))document.getElementById('playbackControls').remove();showMainMenu();restartSimulation();});
    const pBar=ctrlDiv.querySelector('.progress-bar'),pHandle=ctrlDiv.querySelector('#progressHandle');
    function scrub(e){const r=pBar.getBoundingClientRect(),x=e.clientX-r.left;const p=Math.max(0,Math.min(1,x/r.width));const fI=Math.floor(p*(playbackFrameNumbers.length-1));showPlaybackFrame(fI);}
    pBar.addEventListener('click',scrub);let isDragging=false;pHandle.addEventListener('mousedown',()=>{isDragging=true;pHandle.style.cursor='grabbing';});
    document.addEventListener('mousemove',(e)=>{if(isDragging)scrub(e);});document.addEventListener('mouseup',()=>{if(isDragging){isDragging=false;pHandle.style.cursor='grab';}});
    updateProgressUI();
}
function updateProgressUI(){
    if(!document.getElementById('progressFill'))return;
    const p=playbackFrameNumbers.length>1?(currentPlaybackFrame/(playbackFrameNumbers.length-1))*100:0;
    document.getElementById('progressFill').style.width=`${p}%`;document.getElementById('progressHandle').style.left=`${p}%`;
    document.getElementById('frameInfo').textContent=`Frame: ${currentPlaybackFrame}/${playbackFrameNumbers.length-1||0}`;
}
function showPlaybackFrame(frameIndex){
    if(frameIndex<0||frameIndex>=playbackFrameNumbers.length||!playbackFrameNumbers.length)return;
    currentPlaybackFrame=frameIndex;const fN=playbackFrameNumbers[frameIndex],fD=playbackFrames[fN];
    if(!fD||!geometry||!geometry.attributes.position){console.warn('No data for frame:',frameIndex);return;}
    const pos=geometry.attributes.position.array;pos.fill(0);
    for(const p of fD){const idx=Math.floor(p.particle_index);if(idx>=0&&idx*3+2<pos.length){pos[idx*3]=p.x;pos[idx*3+1]=p.y;pos[idx*3+2]=p.z;}}
    geometry.attributes.position.needsUpdate=true;updateProgressUI();
}
function togglePlayback(){isPlaying=!isPlaying;const btn=document.getElementById('playPauseBtn');if(isPlaying){if(btn)btn.textContent='Pause';playbackInterval=setInterval(advancePlayback,playbackSpeed);}else{if(btn)btn.textContent='Play';stopPlayback();}}
function stopPlayback(){if(playbackInterval)clearInterval(playbackInterval);playbackInterval=null;isPlaying=false;}
function advancePlayback(){if(currentPlaybackFrame<playbackFrameNumbers.length-1){showPlaybackFrame(currentPlaybackFrame+1);}else{stopPlayback();const btn=document.getElementById('playPauseBtn');if(btn)btn.textContent='Play';}}

async function sendParticlesToBackend(particlesData){
    const BATCH_SIZE=5000,MAX_RETRIES=5,BASE_DELAY=20;
    for(let idx=0;idx<particlesData.length;idx+=BATCH_SIZE){const batch=particlesData.slice(idx,idx+BATCH_SIZE);let attempt=0;
        while(attempt<MAX_RETRIES){try{const res=await fetch('http://localhost:3001/particles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(batch)});if(res.ok){console.log(`Particles batch sent. Batch:${Math.floor(idx/BATCH_SIZE)+1}`);break;}else{throw new Error('Server error particles');}}catch(e){attempt++;if(attempt>=MAX_RETRIES){console.error('Failed particles batch send.');break;}const delay=BASE_DELAY*Math.pow(2,attempt);await new Promise(r=>setTimeout(r,delay));}}}
}
async function sendParticleSnapshotsToBackend(snapshots){
    const BATCH_SIZE=5000,MAX_RETRIES=5,BASE_DELAY=20;
    for(let idx=0;idx<snapshots.length;idx+=BATCH_SIZE){const batch=snapshots.slice(idx,idx+BATCH_SIZE);let attempt=0;
        while(attempt<MAX_RETRIES){try{const res=await fetch('http://localhost:3001/particle_snapshots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(batch)});if(res.ok){console.log(`Snapshots batch sent. Batch:${Math.floor(idx/BATCH_SIZE)+1}`);break;}else{throw new Error('Server error snapshots');}}catch(e){attempt++;if(attempt>=MAX_RETRIES){console.error('Failed snapshots batch send.');break;}const delay=BASE_DELAY*Math.pow(2,attempt);await new Promise(r=>setTimeout(r,delay));}}}
}
let previousVelocities=null;let frameNumber=0;

async function collectAndSendParticleSnapshots() {
    const isInteractiveNoLogMode = (selectedChoice === 1 || selectedChoice === 2) && !enableDatabaseLogging;
    if (!gpuCompute || !renderer || !positionVariable || !velocityVariable) return;

    const velTexture = gpuCompute.getCurrentRenderTarget(velocityVariable).texture; // Read once
    const size = Math.round(Math.sqrt(effectController.numberOfStars));
    const velBuffer = new Float32Array(size * size * 4);
    renderer.readRenderTargetPixels(velTexture, 0, 0, size, size, velBuffer); // Read velocity data

    if (isInteractiveNoLogMode) {
        previousVelocities = velBuffer.slice(); 
        frameNumber++;
        return; 
    }

    // --- Proceed with full snapshot collection and sending ---
    const posBuffer = new Float32Array(size * size * 4); // Only read position if logging
    renderer.readRenderTargetPixels(gpuCompute.getCurrentRenderTarget(positionVariable).texture, 0, 0, size, size, posBuffer);

    let accBuffer = null;
    if (previousVelocities && effectController.timeStep > 0) {
        accBuffer = new Float32Array(size * size * 4);
        for (let i = 0; i < velBuffer.length; i += 4) {
            accBuffer[i]   = (velBuffer[i]   - previousVelocities[i])   / effectController.timeStep;
            accBuffer[i+1] = (velBuffer[i+1] - previousVelocities[i+1]) / effectController.timeStep;
            accBuffer[i+2] = (velBuffer[i+2] - previousVelocities[i+2]) / effectController.timeStep;
            accBuffer[i+3] = 0;
        }
    }
    const snapshots = []; const totalParticles = posBuffer.length / 4;
    let samplingRate = 1;
    if (totalParticles > 100000) samplingRate = Math.floor(totalParticles / 10000);
    else if (totalParticles > 10000) samplingRate = Math.floor(totalParticles / 1000);

    for (let k = 0, idx = 0; k < posBuffer.length; k += 4, idx++) {
        if (idx % samplingRate !== 0) continue;
        const x=posBuffer[k], y=posBuffer[k+1], z=posBuffer[k+2]; const vx=velBuffer[k], vy=velBuffer[k+1], vz=velBuffer[k+2];
        const speed=Math.sqrt(vx*vx+vy*vy+vz*vz); let ax=0,ay=0,az=0,force=0;
        if(accBuffer){ax=accBuffer[k];ay=accBuffer[k+1];az=accBuffer[k+2];force=Math.sqrt(ax*ax+ay*ay+az*az);}
        snapshots.push({frame_number:frameNumber,particle_index:idx,x,y,z,vx,vy,vz,speed,ax,ay,az,force});
    }
    if (snapshots.length > 0) await sendParticleSnapshotsToBackend(snapshots);
    previousVelocities = velBuffer.slice(); frameNumber++;
    const isHeadless = selectedChoice === 0; // Assuming 0 might be used for headless internally
    if (frameNumber % 10 === 0 && (enableDatabaseLogging || isHeadless)) {
       console.log(`Snapshot data for frame ${frameNumber}: ${snapshots.length} particles (sampling 1:${samplingRate})`);
    }
}

function showLoadingMessage(message){let d=document.getElementById('loading-message');if(!d){d=document.createElement('div');d.id='loading-message';Object.assign(d.style,{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',background:'rgba(0,0,0,0.8)',color:'#fff',padding:'2em 3em',fontSize:'2em',borderRadius:'1em',zIndex:'9999'});document.body.appendChild(d);}d.innerText=message;}
function hideLoadingMessage(){const d=document.getElementById('loading-message');if(d)d.remove();}
let startButton=null;
function primeSimulation(){paused=true;showLoadingMessage('Loading particles...');setTimeout(()=>{showLoadingMessage('Ready!');if(!startButton){startButton=document.createElement('button');startButton.innerText='Start Simulation';Object.assign(startButton.style,{position:'fixed',top:'60%',left:'50%',transform:'translate(-50%,-50%)',fontSize:'1.5em',padding:'0.5em 2em',zIndex:'10000',cursor:'pointer'});startButton.onclick=()=>{paused=false;hideLoadingMessage();if(startButton)startButton.remove();startButton=null;};document.body.appendChild(startButton);}},500);}

window.addEventListener('DOMContentLoaded',()=>{
    const headlessBtn=document.getElementById('headlessBtn');if(headlessBtn)headlessBtn.onclick=showHeadlessPrompt;
    document.getElementById("choice1")?.addEventListener("click",()=>selectChoice(1));
    document.getElementById("choice2")?.addEventListener("click",()=>selectChoice(2));
    document.getElementById("replayBtn")?.addEventListener("click",()=>selectChoice(3)); // Changed to call selectChoice
    document.getElementById("sqlViewBtn")?.addEventListener("click",()=>selectChoice(4)); // Changed to call selectChoice
    if(!document.getElementById('main-container')) showMainMenu(); // Show main menu if not already present from HTML
});

function showHeadlessPrompt(){
    hideMainMenu();const o=document.createElement('div');o.id='headless-overlay';Object.assign(o.style,{position:'fixed',top:'0',left:'0',width:'100vw',height:'100vh',background:'rgba(0,0,0,0.85)',display:'flex',flexDirection:'column',justifyContent:'center',alignItems:'center',zIndex:'9999'});
    const f=document.createElement('form');Object.assign(f.style,{background:'#222',padding:'2em 3em',borderRadius:'1em',display:'flex',flexDirection:'column',gap:'1em',color:'#fff'});
    f.innerHTML=`<h2>Headless Sim</h2><label>FPS:<input id="headless-fps" type="number" min="1" max="1000" value="110"></label><label>Duration (min):<input id="headless-mins" type="number" min="1" max="120" value="5"></label><label><input id="clear-db" type="checkbox">Overwrite DB</label><button type="submit" style="padding:0.5em 1em;background:#4a9eff;color:white;border:none;border-radius:4px;cursor:pointer;">Start</button>`;
    f.onsubmit=async e=>{e.preventDefault();const fps=parseInt(document.getElementById('headless-fps').value)||110;const mins=parseInt(document.getElementById('headless-mins').value)||5;const clearDb=document.getElementById('clear-db').checked;o.remove();if(clearDb)await clearDatabase();await primeHeadlessSimulation({fps,mins});};
    o.appendChild(f);document.body.appendChild(o);
}
async function clearDatabase(){showLoadingMessage('Clearing DB...');try{await fetch('http://localhost:3001/maintenance/clear',{method:'POST'});}catch(e){alert('Failed to clear DB.');}hideLoadingMessage();}
let headlessPaused=true,headlessShouldStop=false,headlessProgressDiv=null;
async function fillUniverseTextures_Async(texturePosition,textureVelocity){
    const posArray=texturePosition.image.data;const velArray=textureVelocity.image.data;const radius=effectController.radius;let pulseScale=5;
    for(let k=0,kl=posArray.length;k<kl;k+=4){let x,y,z;do{x=(Math.random()*2-1);y=(Math.random()*2-1);z=(Math.random()*2-1);}while(x*x+y*y+z*z>1);x*=radius;y*=radius;z*=radius;const vx=pulseScale*x,vy=pulseScale*y,vz=pulseScale*z;posArray[k+0]=x;posArray[k+1]=y;posArray[k+2]=z;posArray[k+3]=(k>0.85*(posArray.length/4))?1:0;velArray[k+0]=vx;velArray[k+1]=vy;velArray[k+2]=vz;velArray[k+3]=0;}
    const particlesData=[];for(let k=0,kl=posArray.length;k<kl;k+=4){particlesData.push({x:posArray[k],y:posArray[k+1],z:posArray[k+2],vx:velArray[k],vy:velArray[k+1],vz:velArray[k+2]});}
    if(particlesData.length>0)await sendParticlesToBackend(particlesData);
}
async function primeHeadlessSimulation({fps,mins}){
    const totalFrames=fps*mins*60;
    effectController={gravity:225.0,interactionRate:0.05,timeStep:0.0001,blackHoleForce:100.0,luminosity:0.25,maxAccelerationColor:2.0,maxAccelerationColorPercent:20,motionBlur:false,hideDarkMatter:false,numberOfStars:100000,radius:2,height:5,middleVelocity:2,velocity:15,typeOfSimulation:2,autoRotation:false};
    PARTICLES=effectController.numberOfStars;const canvas=document.createElement('canvas');renderer=new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:"low-power"});renderer.setSize(1,1);
    let textureSize=Math.round(Math.sqrt(PARTICLES));gpuCompute=new GPUComputationRenderer(textureSize,textureSize,renderer);if(renderer.capabilities.isWebGL2===false)gpuCompute.setDataType(THREE.HalfFloatType);
    const dtPosition=gpuCompute.createTexture();const dtVelocity=gpuCompute.createTexture();
    await fillUniverseTextures_Async(dtPosition,dtVelocity); // Uses async fill
    velocityVariable=gpuCompute.addVariable('textureVelocity',computeShaderVelocity,dtVelocity);positionVariable=gpuCompute.addVariable('texturePosition',computeShaderPosition,dtPosition);
    gpuCompute.setVariableDependencies(velocityVariable,[positionVariable,velocityVariable]);gpuCompute.setVariableDependencies(positionVariable,[positionVariable,velocityVariable]);
    velocityUniforms=velocityVariable.material.uniforms;
    Object.assign(velocityUniforms,{'gravity':{value:effectController.gravity},'interactionRate':{value:effectController.interactionRate},'timeStep':{value:effectController.timeStep},'uMaxAccelerationColor':{value:effectController.maxAccelerationColor},'blackHoleForce':{value:effectController.blackHoleForce},'luminosity':{value:effectController.luminosity}});
    const error=gpuCompute.init();if(error!==null){alert('Error GPU headless: '+error);return;}
    previousVelocities=null;frameNumber=0;headlessPaused=true;headlessShouldStop=false;showHeadlessLoadingScreen({fps,mins,totalFrames});
}
function showHeadlessLoadingScreen({fps,mins,totalFrames}){
    if(headlessProgressDiv)headlessProgressDiv.remove();headlessProgressDiv=document.createElement('div');headlessProgressDiv.id='headless-progress';Object.assign(headlessProgressDiv.style,{position:'fixed',top:'0',left:'0',width:'100vw',height:'100vh',background:'rgba(0,0,0,0.85)',display:'flex',flexDirection:'column',justifyContent:'center',alignItems:'center',zIndex:'10000'});
    headlessProgressDiv.innerHTML=`<div style="background:#222;padding:2em 3em;border-radius:1em;color:#fff;display:flex;flex-direction:column;align-items:center;gap:1em;"><h2>Headless Initialized</h2><p>Run:<b>${mins}min</b>@<b>${fps}fps</b>(${totalFrames} frames)</p><button id="start-headless-btn" style="font-size:1.2em;padding:0.5em 2em;background:#4a9eff;color:white;border:none;border-radius:4px;cursor:pointer;">Start</button><button id="cancel-headless-btn" style="font-size:1em;padding:0.3em 1.5em;background:#444;color:white;border:none;border-radius:4px;cursor:pointer;">Cancel</button><div id="headless-progress-bar" style="width:300px;height:20px;background:#444;border-radius:10px;overflow:hidden;margin-top:1em;display:none;"><div id="headless-progress-fill" style="height:100%;width:0%;background:#4caf50;"></div></div><div id="headless-progress-text" style="margin-top:0.5em;display:none;"></div></div>`;
    document.body.appendChild(headlessProgressDiv);
    document.getElementById('start-headless-btn').onclick=()=>{headlessPaused=false;document.getElementById('start-headless-btn').disabled=true;document.getElementById('cancel-headless-btn').disabled=true;runHeadlessSimulationWithProgress({fps,mins,totalFrames});};
    document.getElementById('cancel-headless-btn').onclick=()=>{headlessShouldStop=true;if(headlessProgressDiv)headlessProgressDiv.remove();showMainMenu();};
}
async function runHeadlessSimulationWithProgress({fps,mins,totalFrames}){
    showHeadlessProgressBar(0,totalFrames,0,fps,mins);let startTime=Date.now();
    selectedChoice = 0; // Indicate a non-interactive, logging mode for collectAndSendParticleSnapshots
    enableDatabaseLogging = true; // Ensure headless always logs
    for(let i=0;i<totalFrames;i++){
        if(headlessShouldStop)break;while(headlessPaused)await new Promise(r=>setTimeout(r,100));
        gpuCompute.compute();
        if(i%snapshotFrameInterval===0) await collectAndSendParticleSnapshots();
        if(i%10===0){let elapsed=(Date.now()-startTime)/1000;let percent=(i+1)/totalFrames;let estRemain=percent>0?(elapsed/percent)-elapsed:0;showHeadlessProgressBar(i+1,totalFrames,estRemain,fps,mins);await new Promise(r=>setTimeout(r,0));}
    }
    if(headlessProgressDiv)headlessProgressDiv.remove();showMainMenu();alert('Headless simulation complete!');
    selectedChoice = 1; // Reset selected choice after headless
}
function showHeadlessProgressBar(current,total,secondsLeft,fps,mins){
    const bar=document.getElementById('headless-progress-bar'),fill=document.getElementById('headless-progress-fill'),text=document.getElementById('headless-progress-text');if(!bar||!fill||!text)return;
    bar.style.display='block';text.style.display='block';let percent=Math.floor((current/total)*100);fill.style.width=percent+'%';
    let min=Math.floor(secondsLeft/60),sec=Math.floor(secondsLeft%60);text.innerHTML=`Progress:${percent}% — ~${min}m ${sec}s left`;
}

function showMainMenu(){
    const em=document.getElementById('main-container');if(em)em.style.display='flex';
    else{const mc=document.createElement('div');mc.id='main-container';Object.assign(mc.style,{position:'fixed',top:'0',left:'0',width:'100vw',height:'100vh',background:'rgba(0,0,0,0.85)',display:'flex',flexDirection:'column',justifyContent:'center',alignItems:'center',zIndex:'9990'});
    mc.innerHTML=`<h1 style='color:#fff;font-size:2.5em;margin-bottom:1em;text-shadow:0 0 10px #4a9eff;'>Galaxy Simulator</h1><button id="choice1">Normal Mode</button><button id="choice2">Experimental Mode</button><button id="replayBtn">Replay Simulation</button><button id="headlessBtn">Headless Mode</button><button id="sqlViewBtn">SQL Database View</button>`;
    mc.querySelectorAll('button').forEach(btn => Object.assign(btn.style, {margin:'0.7em',fontSize:'1.2em',padding:'0.8em 2em',width:'250px',color:'white',border:'none',borderRadius:'5px',cursor:'pointer'}));
    mc.querySelector('#choice1').style.background='#4a9eff'; mc.querySelector('#choice2').style.background='#4a9eff';
    mc.querySelector('#replayBtn').style.background='#33cc33'; mc.querySelector('#headlessBtn').style.background='#ff9900'; mc.querySelector('#sqlViewBtn').style.background='#9966ff';
    document.body.appendChild(mc);
    document.getElementById("choice1").addEventListener("click",()=>selectChoice(1));document.getElementById("choice2").addEventListener("click",()=>selectChoice(2));
    document.getElementById("replayBtn").addEventListener("click",()=>selectChoice(3));document.getElementById("headlessBtn").addEventListener("click",showHeadlessPrompt);document.getElementById("sqlViewBtn").addEventListener("click",()=>selectChoice(4));}
    ['headless-overlay','sql-view-container','playbackControls','headless-progress','loading-message','logging-preference-dialog'].forEach(id=>{const el=document.getElementById(id);if(el)el.remove();});
    if(startButton)startButton.remove();startButton=null;stopPlayback();
}

function restartSimulation(){
    paused=false;stopPlayback();
    if(scene){if(particles)scene.remove(particles);}
    if(material)material.dispose();if(geometry)geometry.dispose();
    const guiElements=document.getElementsByClassName('dg');while(guiElements.length>0)guiElements[0].parentNode.removeChild(guiElements[0]);
    if(container&&container.parentNode===document.body){document.body.removeChild(container);container=null;}
    const canvases=document.querySelectorAll('canvas');canvases.forEach(cvs=>{if(cvs.parentNode===document.body||(container&&cvs.parentNode===container))cvs.remove();});
    camera=undefined;scene=undefined;renderer=undefined;geometry=undefined;composer=undefined;gpuCompute=undefined;velocityVariable=undefined;positionVariable=undefined;velocityUniforms=undefined;particleUniforms=undefined;particles=undefined;material=undefined;controls=undefined;bloomPass=undefined;stats=undefined;
    if(typeof init==='function'){init(effectController.typeOfSimulation.toString());}else{console.error("init not defined for restart!");}
    if(!animationFrameId)animate();
}

function animate(){
    animationFrameId=requestAnimationFrame(animate);
    if(controls&&selectedChoice!==3&&selectedChoice!==4)controls.update(); // No controls update for replay/SQL
    if(selectedChoice===3){if(renderer&&scene&&camera)renderer.render(scene,camera);}
    else if(selectedChoice===1||selectedChoice===2){renderSimulation();}
    else if(selectedChoice === 4) { /* SQL view doesn't render via three.js */ }
    if(stats)stats.update();
}
function renderSimulation(){
    if(!gpuCompute||!renderer||!scene||!camera||!material||!composer)return;
    if(!paused){gpuCompute.compute();particleUniforms['texturePosition'].value=gpuCompute.getCurrentRenderTarget(positionVariable).texture;particleUniforms['textureVelocity'].value=gpuCompute.getCurrentRenderTarget(velocityVariable).texture;material.uniforms.uMaxAccelerationColor.value=effectController.maxAccelerationColor;}
    const hasBlendPass=composer.passes.includes(blendPass);
    if(effectController.motionBlur&&!hasBlendPass){const rIdx=composer.passes.findIndex(p=>p instanceof RenderPass),bIdx=composer.passes.findIndex(p=>p instanceof UnrealBloomPass);if(composer.passes.includes(savePass))composer.removePass(savePass);if(composer.passes.includes(blendPass))composer.removePass(blendPass);if(composer.passes.includes(outputPass))composer.removePass(outputPass);let iAt=Math.max(rIdx,bIdx)+1;composer.insertPass(blendPass,iAt++);composer.insertPass(savePass,iAt++);composer.insertPass(outputPass,iAt++);}
    else if(!effectController.motionBlur&&hasBlendPass){composer.removePass(blendPass);composer.removePass(savePass);composer.removePass(outputPass);}
    material.uniforms.uLuminosity.value=effectController.luminosity;material.uniforms.uHideDarkMatter.value=effectController.hideDarkMatter;
    composer.render();
    if(!paused&&(frameNumber%snapshotFrameInterval===0)){collectAndSendParticleSnapshots();}
}

// ADDED: Dialog for logging preference
function showLoggingPreferenceDialog(choice) {
    hideMainMenu();
    if (loggingDialog && loggingDialog.parentNode) loggingDialog.remove();
    loggingDialog = document.createElement('div'); loggingDialog.id = 'logging-preference-dialog';
    Object.assign(loggingDialog.style, {position:'fixed',top:'0',left:'0',width:'100vw',height:'100vh',background:'rgba(0,0,0,0.85)',display:'flex',flexDirection:'column',justifyContent:'center',alignItems:'center',zIndex:'10000'});
    const dContent = document.createElement('div');
    Object.assign(dContent.style, {background:'#1a1a1a',padding:'30px 40px',borderRadius:'10px',border:'2px solid #4a9eff',color:'white',fontFamily:"'Courier New',monospace",textAlign:'center'});
    const modeName = choice===1?"Normal Mode":"Experimental Mode";
    dContent.innerHTML = `<h2 style="color:#4a9eff;margin-top:0;margin-bottom:25px;">${modeName} Options</h2><p style="margin-bottom:30px;font-size:1.1em;">Choose simulation logging:</p>
        <div style="display:flex;flex-direction:column;gap:15px;">
        <button id="run-with-logging">Run with Database Logging</button>
        <button id="run-locally">Run Locally (No Logging)</button>
        <button id="cancel-logging-choice" style="margin-top:20px;">Back to Main Menu</button></div>`;
    dContent.querySelectorAll('button').forEach(b => Object.assign(b.style, {padding:'12px 20px',fontSize:'1.1em',color:'white',border:'none',borderRadius:'5px',cursor:'pointer'}));
    dContent.querySelector('#run-with-logging').style.background = '#28a745';
    dContent.querySelector('#run-locally').style.background = '#007bff';
    dContent.querySelector('#cancel-logging-choice').style.background = '#6c757d';
    loggingDialog.appendChild(dContent); document.body.appendChild(loggingDialog);
    document.getElementById('run-with-logging').onclick=()=>{enableDatabaseLogging=true;if(loggingDialog.parentNode)loggingDialog.remove();proceedWithSimulationChoice(choice);};
    document.getElementById('run-locally').onclick=()=>{enableDatabaseLogging=false;if(loggingDialog.parentNode)loggingDialog.remove();proceedWithSimulationChoice(choice);};
    document.getElementById('cancel-logging-choice').onclick=()=>{if(loggingDialog.parentNode)loggingDialog.remove();showMainMenu();};
}

// ADDED: Function to proceed after logging preference
function proceedWithSimulationChoice(choice) {
    console.log(`Proceeding: ${choice}, DB Logging: ${enableDatabaseLogging}`);
    selectedChoice = choice; paused = false; frameNumber = 0; previousVelocities = null; stopPlayback();
    if (selectedChoice === 1) { // Normal Mode Defaults
        effectController={gravity:225.0,interactionRate:0.05,timeStep:0.0001,blackHoleForce:100.0,luminosity:0.25,maxAccelerationColor:2.0,maxAccelerationColorPercent:20,motionBlur:false,hideDarkMatter:false,numberOfStars:100000,radius:2,height:5,middleVelocity:2,velocity:15,typeOfSimulation:2,autoRotation:false};
        bloom.strength=0.7;
    } else if (selectedChoice === 2) { // Experimental Mode Defaults
        effectController={gravity:20.0,interactionRate:0.05,timeStep:0.0001,blackHoleForce:100.0,luminosity:0.25,maxAccelerationColor:2.0,maxAccelerationColorPercent:20,motionBlur:false,hideDarkMatter:false,numberOfStars:1000000,radius:3,height:7,middleVelocity:2,velocity:18,typeOfSimulation:2,autoRotation:true};
        bloom.strength=0.6;
    }
    if(selectedChoice===1||selectedChoice===2) restartSimulation();
    if(!animationFrameId) animate();
}

// MODIFIED: selectChoice to use the new dialog flow
function selectChoice(choice) {
    if (choice === 1 || choice === 2) {
        showLoggingPreferenceDialog(choice); // Show dialog for modes 1 & 2
    } else if (choice === 3) { // Replay Mode
        console.log('Selecting choice: Replay Mode');
        selectedChoice = 3; hideMainMenu(); selectReplayMode();
        if(!animationFrameId) animate(); // Ensure animate loop for replay rendering
    } else if (choice === 4) { // SQL View
        console.log('Selecting choice: SQL View');
        selectedChoice = 4; hideMainMenu(); selectSQLView();
        // SQL view manages its own screen, animate loop might not be needed or handled differently
        if (animationFrameId) { cancelAnimationFrame(animationFrameId); animationFrameId = null; } // Stop three.js rendering
    }
}

function selectSQLView(){console.log('Open SQL View...');hideMainMenu();selectedChoice=4;createSQLViewInterface();}
function createSQLViewInterface(){
    if(document.getElementById('sql-view-container'))return;const sC=document.createElement('div');sC.id='sql-view-container';sC.style.cssText=`position:fixed;top:0;left:0;width:100%;height:100%;background:#0a0a0a;color:white;font-family:'Courier New',monospace;overflow:hidden;z-index:1000;`;
    const h=document.createElement('div');h.style.cssText=`background:linear-gradient(45deg,#1a1a2e,#16213e);padding:20px;border-bottom:2px solid #4a9eff;display:flex;justify-content:space-between;align-items:center;`;h.innerHTML=`<h1 style="margin:0;color:#4a9eff;font-size:24px;">🗄️ DB Query</h1><button id="backToMenuBtnSQL">← Menu</button>`;
    const c=document.createElement('div');c.style.cssText=`display:flex;height:calc(100% - 84px);`;
    const sb=document.createElement('div');sb.style.cssText=`width:300px;background:#1a1a1a;border-right:2px solid #333;padding:20px;overflow-y:auto;flex-shrink:0;`;sb.innerHTML=`<h3 style="color:#4a9eff;margin-top:0;">Schema</h3><div id="schema-info">Loading...</div><h3 style="color:#4a9eff;margin-top:30px;">Quick Queries</h3><div id="quick-queries"></div>`;
    const qA=document.createElement('div');qA.style.cssText=`flex:1;display:flex;flex-direction:column;padding:20px;`;
    const qI=document.createElement('div');qI.style.cssText=`margin-bottom:20px;`;qI.innerHTML=`<h3 style="color:#4a9eff;margin-top:0;">SQL</h3><textarea id="sql-query" placeholder="SELECT * FROM particle_snapshots LIMIT 10;" style="width:100%;height:120px;background:#2a2a2a;color:white;border:2px solid #333;border-radius:5px;padding:10px;font-size:14px;resize:vertical;"></textarea><div style="margin-top:10px;"><button id="execute-query-btn">Execute</button><button id="clear-query-btn">Clear</button><span id="query-status"></span></div>`;
    qI.querySelectorAll('button').forEach(b=>Object.assign(b.style,{background:'#4a9eff',color:'white',border:'none',padding:'10px 20px',borderRadius:'5px',cursor:'pointer',fontWeight:'bold',marginRight:'10px'}));qI.querySelector('#clear-query-btn').style.background='#666';qI.querySelector('#query-status').style.cssText='margin-left:20px;color:#888';
    const rA=document.createElement('div');rA.style.cssText=`flex:1;display:flex;flex-direction:column;`;rA.innerHTML=`<h3 style="color:#4a9eff;margin-top:0;margin-bottom:10px;">Results</h3><div id="results-container" style="flex:1;background:#1a1a1a;border:2px solid #333;border-radius:5px;overflow:auto;position:relative;"><div id="results-placeholder" style="padding:40px;text-align:center;color:#666;">Enter SELECT query.</div></div>`;
    c.appendChild(sb);c.appendChild(qA);qA.appendChild(qI);qA.appendChild(rA);sC.appendChild(h);sC.appendChild(c);document.body.appendChild(sC);
    const st=document.createElement('style');st.textContent=`.quick-query-btn{display:block;width:100%;margin-bottom:8px;padding:8px 12px;background:#333;color:white;border:1px solid #555;border-radius:3px;cursor:pointer;font-size:12px;text-align:left;transition:background .2s}.quick-query-btn:hover{background:#444}.results-table{width:100%;border-collapse:collapse;font-size:12px}.results-table th,.results-table td{padding:8px 12px;text-align:left;border-bottom:1px solid #333;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.results-table th{background:#2a2a2a;color:#4a9eff;font-weight:bold;position:sticky;top:0;z-index:10}.results-table tr:hover{background:#222}.results-table td{color:#ddd}`;document.head.appendChild(st);
    setupSQLViewEventListeners();loadDatabaseSchema();addQuickQueries();
}
function setupSQLViewEventListeners(){
    document.getElementById('backToMenuBtnSQL').addEventListener('click',()=>{document.getElementById('sql-view-container').remove();showMainMenu();/* restartSimulation(); // No need to restart sim when coming from SQL view */});
    document.getElementById('execute-query-btn').addEventListener('click',()=>{const q=document.getElementById('sql-query').value.trim();if(q)executeQuery(q);});
    document.getElementById('clear-query-btn').addEventListener('click',()=>{document.getElementById('sql-query').value='';document.getElementById('query-status').textContent='';});
    document.addEventListener('click',(e)=>{if(e.target.classList.contains('quick-query-btn')){const q=e.target.getAttribute('data-query');document.getElementById('sql-query').value=q;executeQuery(q);}});
    document.getElementById('sql-query').addEventListener('keydown',(e)=>{if(e.ctrlKey&&e.key==='Enter'){const q=e.target.value.trim();if(q)executeQuery(q);}});
}
async function loadDatabaseSchema(){try{const r=await fetch('http://localhost:3001/sql/schema');const d=await r.json();if(d.success)displaySchema(d.tables);else document.getElementById('schema-info').innerHTML=`<div style="color:#ff6b6b;">Error:${d.error}</div>`;}catch(e){document.getElementById('schema-info').innerHTML=`<div style="color:#ff6b6b;">Connect failed:${e.message}</div>`;}}
function displaySchema(tables){const sC=document.getElementById('schema-info');let h='';for(const[tN,tI]of Object.entries(tables)){h+=`<div style="margin-bottom:20px;"><h4 style="color:#51cf66;margin:0 0 8px 0;">${tN}</h4><div style="font-size:11px;color:#888;margin-bottom:8px;">${tI.type}</div>`;for(const c of tI.columns)h+=`<div style="margin-left:10px;font-size:11px;color:#ccc;"><span style="color:#ffd93d;">${c.column_name}</span> <span style="color:#74c0fc;">${c.data_type}</span><span style="color:#888;">${c.is_nullable==='YES'?'?':'!'}</span></div>`;h+=`</div>`;}sC.innerHTML=h;}
function addQuickQueries(){const qC=document.getElementById('quick-queries');const qs=[{name:"Total Snapshots",query:"SELECT COUNT(*) as total_snapshots FROM particle_snapshots;"},{name:"Total Frames",query:"SELECT COUNT(DISTINCT frame_number) as total_frames FROM particle_snapshots;"},{name:"Frame Range",query:"SELECT MIN(frame_number) as min_f,MAX(frame_number) as max_f FROM particle_snapshots;"},{name:"Particles/Frame(Top10)",query:"SELECT frame_number,COUNT(*)as p_count FROM particle_snapshots GROUP BY frame_number ORDER BY frame_number LIMIT 10;"},{name:"Recent 100 Snapshots",query:"SELECT * FROM particle_snapshots ORDER BY created_at DESC LIMIT 100;"},{name:"Schema: particle_snapshots",query:"SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_name='particle_snapshots';"}];qC.innerHTML=qs.map(q=>`<button class="quick-query-btn" data-query="${q.query.replace(/"/g,'"')}">${q.name}</button>`).join('');}
async function executeQuery(query){const sE=document.getElementById('query-status'),rC=document.getElementById('results-container'),eB=document.getElementById('execute-query-btn');sE.textContent='Executing...';sE.style.color='#ffd93d';eB.disabled=true;eB.textContent='Executing...';try{const rp=await fetch('http://localhost:3001/sql/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query})});const dt=await rp.json();if(dt.success){displayQueryResults(dt);sE.textContent=`✅ ${dt.executionTime}ms - ${dt.rowCount} rows`;sE.style.color='#51cf66';}else{displayQueryError(dt.error,dt.hint);sE.textContent=`❌ Failed:${dt.error.substring(0,50)}...`;sE.style.color='#ff6b6b';}}catch(er){displayQueryError(`Network:${er.message}`);sE.textContent=`❌ Connect Failed`;sE.style.color='#ff6b6b';}finally{eB.disabled=false;eB.textContent='Execute Query';}}
function displayQueryResults(data){const rC=document.getElementById('results-container');if(data.rows.length===0){rC.innerHTML=`<div style="padding:40px;text-align:center;color:#888;">Query OK, 0 rows.</div>`;return;}let h='<table class="results-table"><thead><tr>';data.fields.forEach(f=>h+=`<th>${f}</th>`);h+='</tr></thead><tbody>';data.rows.forEach(r=>{h+='<tr>';data.fields.forEach(f=>{let v=r[f];if(v===null)v='<span style="color:#666;font-style:italic;">NULL</span>';else if(typeof v==='number')v=v.toLocaleString();else if(typeof v==='string'&&v.length>50)v=v.substring(0,47)+'...';h+=`<td>${v}</td>`;});h+='</tr>';});h+='</tbody></table>';rC.innerHTML=h;}
function displayQueryError(error,hint=null){const rC=document.getElementById('results-container');rC.innerHTML=`<div style="padding:20px;"><div style="color:#ff6b6b;font-weight:bold;margin-bottom:10px;">❌ Query Error</div><div style="color:#ddd;margin-bottom:15px;font-family:monospace;background:#2a1a1a;padding:10px;border-radius:3px;">${error}</div>${hint?`<div style="color:#ffd93d;font-weight:bold;margin-bottom:5px;">💡 Hint:</div><div style="color:#ddd;font-family:monospace;background:#1a1a2a;padding:10px;border-radius:3px;">${hint}</div>`:''}</div>`;}

if(document.readyState==='loading')window.addEventListener('DOMContentLoaded',showMainMenu);else showMainMenu();