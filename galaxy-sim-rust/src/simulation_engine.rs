use crate::particle_system::{ParticleSystemSoA, Particle, galaxy_generation};
use crate::binary_format::{SimulationWriter, BinaryFormatError, FrameParticle};
use crate::physics::PhysicsEngine;
use nalgebra::Vector3;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum SimulationError {
    #[error("Binary format error: {0}")]
    BinaryFormat(#[from] BinaryFormatError),
    #[error("Invalid particle count: {0}")]
    InvalidParticleCount(u32),
    #[error("Physics error: {0}")]
    Physics(String),
}

pub struct SimulationEngine {
    particles: ParticleSystemSoA,
    physics: PhysicsEngine,
    time: f32,
    frame_count: u32,
    writer: Option<SimulationWriter>,
}

impl SimulationEngine {
    pub fn new(particle_count: u32) -> Result<Self, SimulationError> {
        if particle_count == 0 || particle_count > 10_000_000 {
            return Err(SimulationError::InvalidParticleCount(particle_count));
        }

        // Generate initial galaxy
        let initial_particles = galaxy_generation::generate_spiral_galaxy(
            particle_count as usize, 
            100.0,  // radius
            5.0     // thickness
        );
        
        let particles = ParticleSystemSoA::from_particles(&initial_particles);
        let physics = PhysicsEngine::new(particle_count as usize);

        crate::log!("✅ Simulation engine created with {} particles", particle_count);

        Ok(Self {
            particles,
            physics,
            time: 0.0,
            frame_count: 0,
            writer: None,
        })
    }

    pub fn start_recording(&mut self, filename: &str, dt: f32) -> Result<(), SimulationError> {
        let writer = SimulationWriter::new(
            filename, 
            self.particles.particle_count as u32, 
            10000, // Estimate 10k frames
            dt
        )?;
        
        self.writer = Some(writer);
        crate::log!("🎬 Started recording to {}", filename);
        Ok(())
    }

    pub fn stop_recording(&mut self) -> Result<(), SimulationError> {
        if let Some(writer) = self.writer.take() {
            writer.finalize()?;
            crate::log!("⏹️ Recording stopped and finalized");
        }
        Ok(())
    }

    pub fn step(&mut self, dt: f32) -> Result<(), SimulationError> {
        // Calculate forces and update velocities
        self.physics.calculate_forces(&mut self.particles, dt);
        
        // Update positions using SIMD
        self.particles.update_positions_simd(dt);
        
        // Record frame if recording
        if self.writer.is_some() {
            // Convert particle data to frame format
            let frame_particles = self.particles_to_frame_data();
            if let Some(ref mut writer) = self.writer {
                writer.write_frame(self.frame_count, self.time, &frame_particles)?;
            }
        }
        
        self.time += dt;
        self.frame_count += 1;
        
        Ok(())
    }

    pub fn save_frame_to_file(&self, filename: &str, _frame_number: u32) -> Result<(), SimulationError> {
        let mut writer = SimulationWriter::new(filename, self.particles.particle_count as u32, 1, 0.0)?;
        let frame_particles = self.particles_to_frame_data();
        writer.write_frame(self.frame_count, self.time, &frame_particles)?;
        writer.finalize()?;
        Ok(())
    }

    // Getters for WebAssembly interface
    pub fn get_particle_count(&self) -> u32 {
        self.particles.particle_count as u32
    }

    pub fn get_positions_ptr(&self) -> *const f32 {
        self.particles.positions_x.as_ptr()
    }

    pub fn get_velocities_ptr(&self) -> *const f32 {
        self.particles.velocities_x.as_ptr()
    }

    pub fn get_time(&self) -> f32 {
        self.time
    }

    pub fn get_frame_count(&self) -> u32 {
        self.frame_count
    }

    /// Get positions as interleaved array (x,y,z,x,y,z,...)
    pub fn get_positions_interleaved(&self) -> Vec<f32> {
        self.particles.get_positions_interleaved()
    }

    /// Get velocities as interleaved array
    pub fn get_velocities_interleaved(&self) -> Vec<f32> {
        self.particles.get_velocities_interleaved()
    }

    /// Reset simulation to initial state
    pub fn reset(&mut self) -> Result<(), SimulationError> {
        // Regenerate initial galaxy
        let initial_particles = galaxy_generation::generate_spiral_galaxy(
            self.particles.particle_count, 
            100.0, 
            5.0
        );
        
        self.particles = ParticleSystemSoA::from_particles(&initial_particles);
        self.time = 0.0;
        self.frame_count = 0;
        
        // Stop any recording
        if self.writer.is_some() {
            self.stop_recording()?;
        }
        
        crate::log!("🔄 Simulation reset to initial state");
        Ok(())
    }

    /// Set custom initial conditions
    pub fn set_particles(&mut self, particles: Vec<Particle>) -> Result<(), SimulationError> {
        if particles.is_empty() {
            return Err(SimulationError::InvalidParticleCount(0));
        }

        self.particles = ParticleSystemSoA::from_particles(&particles);
        self.physics = PhysicsEngine::new(particles.len());
        self.time = 0.0;
        self.frame_count = 0;

        crate::log!("🎯 Custom initial conditions set with {} particles", particles.len());
        Ok(())
    }

    /// Get current kinetic energy for analysis
    pub fn get_kinetic_energy(&self) -> f32 {
        let mut total_ke = 0.0;
        
        for i in 0..self.particles.particle_count {
            let vx = self.particles.velocities_x[i];
            let vy = self.particles.velocities_y[i];
            let vz = self.particles.velocities_z[i];
            let mass = self.particles.masses[i];
            
            let speed_squared = vx * vx + vy * vy + vz * vz;
            total_ke += 0.5 * mass * speed_squared;
        }
        
        total_ke
    }

    /// Get center of mass
    pub fn get_center_of_mass(&self) -> Vector3<f32> {
        let mut com = Vector3::zeros();
        let mut total_mass = 0.0;
        
        for i in 0..self.particles.particle_count {
            let mass = self.particles.masses[i];
            com.x += self.particles.positions_x[i] * mass;
            com.y += self.particles.positions_y[i] * mass;
            com.z += self.particles.positions_z[i] * mass;
            total_mass += mass;
        }
        
        if total_mass > 0.0 {
            com / total_mass
        } else {
            com
        }
    }

    fn particles_to_frame_data(&self) -> Vec<FrameParticle> {
        let mut frame_particles = Vec::with_capacity(self.particles.particle_count);
        
        for i in 0..self.particles.particle_count {
            let pos = [
                self.particles.positions_x[i],
                self.particles.positions_y[i],
                self.particles.positions_z[i],
            ];
            let vel = [
                self.particles.velocities_x[i],
                self.particles.velocities_y[i],
                self.particles.velocities_z[i],
            ];
            let acc = [
                self.particles.accelerations_x[i],
                self.particles.accelerations_y[i],
                self.particles.accelerations_z[i],
            ];
            
            frame_particles.push(FrameParticle {
                position: pos,
                velocity: vel,
                acceleration: acc,
                mass: self.particles.masses[i],
            });
        }
        
        frame_particles
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simulation_creation() {
        let sim = SimulationEngine::new(1000).unwrap();
        assert_eq!(sim.get_particle_count(), 1000);
        assert_eq!(sim.get_time(), 0.0);
    }

    #[test]
    fn test_simulation_step() {
        let mut sim = SimulationEngine::new(100).unwrap();
        let initial_time = sim.get_time();
        
        sim.step(0.01).unwrap();
        
        assert!(sim.get_time() > initial_time);
        assert_eq!(sim.get_frame_count(), 1);
    }

    #[test]
    fn test_invalid_particle_count() {
        assert!(SimulationEngine::new(0).is_err());
        assert!(SimulationEngine::new(20_000_000).is_err());
    }
}
