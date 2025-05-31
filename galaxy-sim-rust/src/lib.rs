use wasm_bindgen::prelude::*;

// Import modules
pub mod particle_system;
pub mod simulation_engine;
pub mod binary_format;
pub mod playback_engine;
pub mod memory_pool;
pub mod physics;

// Re-export main types
pub use particle_system::*;
pub use simulation_engine::*;
pub use binary_format::*;
pub use playback_engine::*;

// Macro to provide println!(..)-style syntax for console.log logging
#[macro_export]
macro_rules! log {
    ( $( $t:tt )* ) => {
        web_sys::console::log_1(&format!( $( $t )* ).into());
    }
}

// Initialize console error panic hook for better error messages
#[cfg(feature = "console_error_panic_hook")]
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

// Main simulation controller that JavaScript will interact with
#[wasm_bindgen]
pub struct GalaxySimulation {
    engine: SimulationEngine,
    playback: Option<PlaybackEngine>,
    current_frame: u32,
}

#[wasm_bindgen]
impl GalaxySimulation {
    #[wasm_bindgen(constructor)]
    pub fn new(particle_count: u32) -> Result<GalaxySimulation, JsValue> {
        let engine = SimulationEngine::new(particle_count)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        
        log!("🚀 Galaxy simulation initialized with {} particles", particle_count);
        
        Ok(GalaxySimulation {
            engine,
            playback: None,
            current_frame: 0,
        })
    }

    #[wasm_bindgen]
    pub fn step_simulation(&mut self, dt: f32) -> Result<(), JsValue> {
        self.engine.step(dt)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.current_frame += 1;
        Ok(())
    }

    #[wasm_bindgen]
    pub fn get_positions_ptr(&self) -> *const f32 {
        self.engine.get_positions_ptr()
    }

    #[wasm_bindgen]
    pub fn get_velocities_ptr(&self) -> *const f32 {
        self.engine.get_velocities_ptr()
    }

    #[wasm_bindgen]
    pub fn get_particle_count(&self) -> u32 {
        self.engine.get_particle_count()
    }

    #[wasm_bindgen]
    pub fn save_frame(&mut self, filename: &str) -> Result<(), JsValue> {
        self.engine.save_frame_to_file(filename, self.current_frame)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen]
    pub fn load_playback(&mut self, filename: &str) -> Result<(), JsValue> {
        let playback = PlaybackEngine::new(filename)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        
        log!("📽️ Loaded playback with {} frames", playback.get_frame_count());
        self.playback = Some(playback);
        Ok(())
    }

    #[wasm_bindgen]
    pub fn get_playback_frame(&mut self, frame_index: u32) -> Result<*const f32, JsValue> {
        match &mut self.playback {
            Some(playback) => {
                let positions = playback.get_frame(frame_index)
                    .map_err(|e| JsValue::from_str(&e.to_string()))?;
                Ok(positions.as_ptr())
            }
            None => Err(JsValue::from_str("No playback data loaded"))
        }
    }

    #[wasm_bindgen]
    pub fn get_frame_count(&self) -> u32 {
        match &self.playback {
            Some(playback) => playback.get_frame_count(),
            None => 0
        }
    }
}
