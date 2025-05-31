use crate::binary_format::{SimulationReader, BinaryFormatError};
use std::collections::HashMap;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum PlaybackError {
    #[error("Binary format error: {0}")]
    BinaryFormat(#[from] BinaryFormatError),
    #[error("Frame {0} out of range")]
    FrameOutOfRange(u32),
    #[error("No simulation loaded")]
    NoSimulationLoaded,
}

pub struct PlaybackEngine {
    reader: SimulationReader,
    frame_cache: HashMap<u32, Vec<f32>>, // Cache for recently accessed frames
    max_cache_size: usize,
    current_frame: u32,
}

impl PlaybackEngine {
    pub fn new(filename: &str) -> Result<Self, PlaybackError> {
        let reader = SimulationReader::new(filename)?;
        let max_cache_size = 100; // Cache up to 100 frames
        
        crate::log!("📽️ Playback engine initialized with {} frames", reader.get_header().frame_count);
        
        Ok(Self {
            reader,
            frame_cache: HashMap::new(),
            max_cache_size,
            current_frame: 0,
        })
    }

    /// Get frame data with caching for ultra-fast access
    pub fn get_frame(&mut self, frame_index: u32) -> Result<&Vec<f32>, PlaybackError> {
        if frame_index >= self.reader.get_header().frame_count {
            return Err(PlaybackError::FrameOutOfRange(frame_index));
        }

        // Check cache first
        if self.frame_cache.contains_key(&frame_index) {
            return Ok(self.frame_cache.get(&frame_index).unwrap());
        }

        // Load frame from memory-mapped file
        let positions = self.reader.get_frame_positions(frame_index)?;
        
        // Manage cache size
        if self.frame_cache.len() >= self.max_cache_size {
            self.evict_oldest_frame();
        }
        
        // Cache the frame
        self.frame_cache.insert(frame_index, positions);
        self.current_frame = frame_index;
        
        Ok(self.frame_cache.get(&frame_index).unwrap())
    }

    /// Get interpolated frame between two frames for smooth playback
    pub fn get_interpolated_frame(&mut self, frame_a: u32, frame_b: u32, t: f32) -> Result<Vec<f32>, PlaybackError> {
        if frame_a >= self.reader.get_header().frame_count || frame_b >= self.reader.get_header().frame_count {
            return Err(PlaybackError::FrameOutOfRange(frame_a.max(frame_b)));
        }

        // Special case: if t is 0 or 1, return exact frame
        if t <= 0.0 {
            return Ok(self.get_frame(frame_a)?.clone());
        }
        if t >= 1.0 {
            return Ok(self.get_frame(frame_b)?.clone());
        }

        // Use reader's interpolation for memory efficiency
        self.reader.get_interpolated_positions(frame_a, frame_b, t)
            .map_err(PlaybackError::from)
    }

    /// Get frame count
    pub fn get_frame_count(&self) -> u32 {
        self.reader.get_header().frame_count
    }

    /// Get particle count
    pub fn get_particle_count(&self) -> u32 {
        self.reader.get_header().particle_count
    }

    /// Get simulation metadata
    pub fn get_simulation_info(&self) -> SimulationInfo {
        let header = self.reader.get_header();
        SimulationInfo {
            particle_count: header.particle_count,
            frame_count: header.frame_count,
            dt: header.dt,
            total_time: header.total_time,
        }
    }

    /// Preload frames around current position for smooth scrubbing
    pub fn preload_frames_around(&mut self, center_frame: u32, radius: u32) -> Result<(), PlaybackError> {
        let start_frame = center_frame.saturating_sub(radius);
        let end_frame = (center_frame + radius).min(self.get_frame_count() - 1);
        
        for frame in start_frame..=end_frame {
            self.get_frame(frame)?;
        }
        
        crate::log!("📦 Preloaded frames {} to {}", start_frame, end_frame);
        Ok(())
    }

    /// Jump to specific frame and preload nearby frames
    pub fn seek_to_frame(&mut self, frame_index: u32) -> Result<Vec<f32>, PlaybackError> {
        let positions = self.get_frame(frame_index)?.clone();
        
        // Preload nearby frames for smooth playback
        if let Err(e) = self.preload_frames_around(frame_index, 10) {
            crate::log!("⚠️ Warning: Could not preload frames: {}", e);
        }
        
        Ok(positions)
    }

    /// Get cache statistics
    pub fn get_cache_stats(&self) -> CacheStats {
        CacheStats {
            cached_frames: self.frame_cache.len(),
            max_cache_size: self.max_cache_size,
            current_frame: self.current_frame,
        }
    }

    /// Clear cache to free memory
    pub fn clear_cache(&mut self) {
        self.frame_cache.clear();
        crate::log!("🗑️ Frame cache cleared");
    }

    /// Set cache size
    pub fn set_cache_size(&mut self, size: usize) {
        self.max_cache_size = size;
        while self.frame_cache.len() > size {
            self.evict_oldest_frame();
        }
    }

    /// Evict oldest frame from cache (simple LRU)
    fn evict_oldest_frame(&mut self) {
        if let Some(&oldest_frame) = self.frame_cache.keys().min() {
            self.frame_cache.remove(&oldest_frame);
        }
    }

    /// Get raw frame data pointer for direct GPU upload
    pub fn get_frame_data_ptr(&mut self, frame_index: u32) -> Result<*const f32, PlaybackError> {
        let positions = self.get_frame(frame_index)?;
        Ok(positions.as_ptr())
    }

    /// Export frame to different format (for analysis)
    pub fn export_frame_csv(&self, frame_index: u32, filename: &str) -> Result<(), PlaybackError> {
        use std::io::Write;
        
        let particles = self.reader.get_frame(frame_index)?;
        let mut file = std::fs::File::create(filename)
            .map_err(|e| BinaryFormatError::Io(e))?;
        
        writeln!(file, "x,y,z,vx,vy,vz,ax,ay,az,mass")
            .map_err(|e| BinaryFormatError::Io(e))?;
        
        for particle in particles {
            writeln!(file, "{},{},{},{},{},{},{},{},{},{}",
                particle.position[0], particle.position[1], particle.position[2],
                particle.velocity[0], particle.velocity[1], particle.velocity[2],
                particle.acceleration[0], particle.acceleration[1], particle.acceleration[2],
                particle.mass
            ).map_err(|e| BinaryFormatError::Io(e))?;
        }
        
        crate::log!("📄 Frame {} exported to {}", frame_index, filename);
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct SimulationInfo {
    pub particle_count: u32,
    pub frame_count: u32,
    pub dt: f32,
    pub total_time: f32,
}

#[derive(Debug, Clone)]
pub struct CacheStats {
    pub cached_frames: usize,
    pub max_cache_size: usize,
    pub current_frame: u32,
}

/// Advanced playback controller for smooth real-time playback
pub struct PlaybackController {
    engine: PlaybackEngine,
    playback_speed: f32,
    is_playing: bool,
    loop_enabled: bool,
    frame_rate: f32,
}

impl PlaybackController {
    pub fn new(filename: &str) -> Result<Self, PlaybackError> {
        let engine = PlaybackEngine::new(filename)?;
        
        Ok(Self {
            engine,
            playback_speed: 1.0,
            is_playing: false,
            loop_enabled: false,
            frame_rate: 60.0,
        })
    }

    /// Start playback
    pub fn play(&mut self) {
        self.is_playing = true;
        crate::log!("▶️ Playback started");
    }

    /// Pause playback
    pub fn pause(&mut self) {
        self.is_playing = false;
        crate::log!("⏸️ Playback paused");
    }

    /// Stop playback and reset to beginning
    pub fn stop(&mut self) {
        self.is_playing = false;
        self.engine.current_frame = 0;
        crate::log!("⏹️ Playback stopped");
    }

    /// Set playback speed (1.0 = normal, 2.0 = 2x speed, 0.5 = half speed)
    pub fn set_speed(&mut self, speed: f32) {
        self.playback_speed = speed.max(0.1).min(10.0);
        crate::log!("🏃 Playback speed set to {}x", self.playback_speed);
    }

    /// Update playback (call this every frame)
    pub fn update(&mut self, delta_time: f32) -> Result<Option<&Vec<f32>>, PlaybackError> {
        if !self.is_playing {
            return Ok(None);
        }

        // Calculate frame advancement
        let frame_delta = delta_time * self.frame_rate * self.playback_speed;
        let new_frame = self.engine.current_frame as f32 + frame_delta;
        let target_frame = new_frame as u32;

        // Handle end of simulation
        if target_frame >= self.engine.get_frame_count() {
            if self.loop_enabled {
                self.engine.current_frame = 0;
            } else {
                self.pause();
                return Ok(None);
            }
        } else {
            // Use interpolation for smooth playback
            let fract = new_frame.fract();
            if fract < 0.01 {
                // Close to integer frame, use exact frame
                return Ok(Some(self.engine.get_frame(target_frame)?));
            } else {
                // Interpolate between frames
                let next_frame = (target_frame + 1).min(self.engine.get_frame_count() - 1);
                let _interpolated = self.engine.get_interpolated_frame(target_frame, next_frame, fract)?;
                
                // Store interpolated result temporarily (this needs better design)
                return Ok(None); // TODO: Handle interpolated results properly
            }
        }

        Ok(None)
    }

    /// Seek to specific time in simulation
    pub fn seek_to_time(&mut self, time: f32) -> Result<Vec<f32>, PlaybackError> {
        let dt = self.engine.reader.get_header().dt;
        let frame_index = (time / dt) as u32;
        self.engine.seek_to_frame(frame_index)
    }

    /// Get current playback progress (0.0 to 1.0)
    pub fn get_progress(&self) -> f32 {
        if self.engine.get_frame_count() == 0 {
            return 0.0;
        }
        self.engine.current_frame as f32 / (self.engine.get_frame_count() - 1) as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::binary_format::{SimulationWriter, FrameParticle};
    use std::fs;

    #[test]
    fn test_playback_engine() {
        let filename = "test_playback.bin";
        
        // Create test data
        {
            let mut writer = SimulationWriter::new(filename, 2, 3, 0.01).unwrap();
            
            for frame in 0..3 {
                let particles = vec![
                    FrameParticle {
                        position: [frame as f32, 0.0, 0.0],
                        velocity: [0.0; 3],
                        acceleration: [0.0; 3],
                        mass: 1.0,
                    },
                    FrameParticle {
                        position: [frame as f32 + 1.0, 0.0, 0.0],
                        velocity: [0.0; 3],
                        acceleration: [0.0; 3],
                        mass: 1.0,
                    },
                ];
                
                writer.write_frame(frame, frame as f32 * 0.01, &particles).unwrap();
            }
            writer.finalize().unwrap();
        }
        
        // Test playback
        {
            let mut playback = PlaybackEngine::new(filename).unwrap();
            assert_eq!(playback.get_frame_count(), 3);
            assert_eq!(playback.get_particle_count(), 2);
            
            let frame_0 = playback.get_frame(0).unwrap();
            assert_eq!(frame_0.len(), 6); // 2 particles * 3 coordinates
            assert_eq!(frame_0[0], 0.0); // First particle x position
        }
        
        // Cleanup
        fs::remove_file(filename).unwrap();
    }
}
