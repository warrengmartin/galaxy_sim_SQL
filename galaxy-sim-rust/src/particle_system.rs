use nalgebra::Vector3;
use bytemuck::{Pod, Zeroable};
use wide::f32x4;

/// Particle structure optimized for SIMD operations
#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct Particle {
    pub position: [f32; 3],
    pub velocity: [f32; 3],
    pub mass: f32,
    pub _padding: f32, // Align to 32 bytes for SIMD
}

impl Particle {
    pub fn new(x: f32, y: f32, z: f32, vx: f32, vy: f32, vz: f32, mass: f32) -> Self {
        Self {
            position: [x, y, z],
            velocity: [vx, vy, vz],
            mass,
            _padding: 0.0,
        }
    }

    pub fn position_vec(&self) -> Vector3<f32> {
        Vector3::new(self.position[0], self.position[1], self.position[2])
    }

    pub fn velocity_vec(&self) -> Vector3<f32> {
        Vector3::new(self.velocity[0], self.velocity[1], self.velocity[2])
    }

    pub fn set_position(&mut self, pos: Vector3<f32>) {
        self.position[0] = pos.x;
        self.position[1] = pos.y;
        self.position[2] = pos.z;
    }

    pub fn set_velocity(&mut self, vel: Vector3<f32>) {
        self.velocity[0] = vel.x;
        self.velocity[1] = vel.y;
        self.velocity[2] = vel.z;
    }
}

/// Structure of Arrays (SoA) layout for better cache performance
pub struct ParticleSystemSoA {
    pub positions_x: Vec<f32>,
    pub positions_y: Vec<f32>,
    pub positions_z: Vec<f32>,
    pub velocities_x: Vec<f32>,
    pub velocities_y: Vec<f32>,
    pub velocities_z: Vec<f32>,
    pub accelerations_x: Vec<f32>,
    pub accelerations_y: Vec<f32>,
    pub accelerations_z: Vec<f32>,
    pub masses: Vec<f32>,
    pub particle_count: usize,
}

impl ParticleSystemSoA {
    pub fn new(capacity: usize) -> Self {
        Self {
            positions_x: vec![0.0; capacity],
            positions_y: vec![0.0; capacity],
            positions_z: vec![0.0; capacity],
            velocities_x: vec![0.0; capacity],
            velocities_y: vec![0.0; capacity],
            velocities_z: vec![0.0; capacity],
            accelerations_x: vec![0.0; capacity],
            accelerations_y: vec![0.0; capacity],
            accelerations_z: vec![0.0; capacity],
            masses: vec![1.0; capacity],
            particle_count: capacity,
        }
    }

    pub fn from_particles(particles: &[Particle]) -> Self {
        let count = particles.len();
        let mut system = Self::new(count);
        
        for (i, particle) in particles.iter().enumerate() {
            system.positions_x[i] = particle.position[0];
            system.positions_y[i] = particle.position[1];
            system.positions_z[i] = particle.position[2];
            system.velocities_x[i] = particle.velocity[0];
            system.velocities_y[i] = particle.velocity[1];
            system.velocities_z[i] = particle.velocity[2];
            system.masses[i] = particle.mass;
        }
        
        system
    }

    /// Get positions as interleaved array for GPU upload
    pub fn get_positions_interleaved(&self) -> Vec<f32> {
        let mut positions = Vec::with_capacity(self.particle_count * 3);
        
        for i in 0..self.particle_count {
            positions.push(self.positions_x[i]);
            positions.push(self.positions_y[i]);
            positions.push(self.positions_z[i]);
        }
        
        positions
    }

    /// Get velocities as interleaved array for GPU upload
    pub fn get_velocities_interleaved(&self) -> Vec<f32> {
        let mut velocities = Vec::with_capacity(self.particle_count * 3);
        
        for i in 0..self.particle_count {
            velocities.push(self.velocities_x[i]);
            velocities.push(self.velocities_y[i]);
            velocities.push(self.velocities_z[i]);
        }
        
        velocities
    }

    /// SIMD-optimized position update
    pub fn update_positions_simd(&mut self, dt: f32) {
        let dt_vec = f32x4::splat(dt);
        
        // Process 4 particles at a time using SIMD
        let chunks = self.particle_count / 4;
        let _remainder = self.particle_count % 4;
        
        for i in 0..chunks {
            let base_idx = i * 4;
            
            // Load positions and velocities
            let pos_x = f32x4::new([
                self.positions_x[base_idx],
                self.positions_x[base_idx + 1],
                self.positions_x[base_idx + 2],
                self.positions_x[base_idx + 3],
            ]);
            let pos_y = f32x4::new([
                self.positions_y[base_idx],
                self.positions_y[base_idx + 1],
                self.positions_y[base_idx + 2],
                self.positions_y[base_idx + 3],
            ]);
            let pos_z = f32x4::new([
                self.positions_z[base_idx],
                self.positions_z[base_idx + 1],
                self.positions_z[base_idx + 2],
                self.positions_z[base_idx + 3],
            ]);
            
            let vel_x = f32x4::new([
                self.velocities_x[base_idx],
                self.velocities_x[base_idx + 1],
                self.velocities_x[base_idx + 2],
                self.velocities_x[base_idx + 3],
            ]);
            let vel_y = f32x4::new([
                self.velocities_y[base_idx],
                self.velocities_y[base_idx + 1],
                self.velocities_y[base_idx + 2],
                self.velocities_y[base_idx + 3],
            ]);
            let vel_z = f32x4::new([
                self.velocities_z[base_idx],
                self.velocities_z[base_idx + 1],
                self.velocities_z[base_idx + 2],
                self.velocities_z[base_idx + 3],
            ]);
            
            // Update positions: pos += vel * dt
            let new_pos_x = pos_x + vel_x * dt_vec;
            let new_pos_y = pos_y + vel_y * dt_vec;
            let new_pos_z = pos_z + vel_z * dt_vec;
            
            // Store back
            let new_pos_x_array = new_pos_x.to_array();
            let new_pos_y_array = new_pos_y.to_array();
            let new_pos_z_array = new_pos_z.to_array();
            
            self.positions_x[base_idx..base_idx + 4].copy_from_slice(&new_pos_x_array);
            self.positions_y[base_idx..base_idx + 4].copy_from_slice(&new_pos_y_array);
            self.positions_z[base_idx..base_idx + 4].copy_from_slice(&new_pos_z_array);
        }
        
        // Handle remaining particles
        for i in chunks * 4..self.particle_count {
            self.positions_x[i] += self.velocities_x[i] * dt;
            self.positions_y[i] += self.velocities_y[i] * dt;
            self.positions_z[i] += self.velocities_z[i] * dt;
        }
    }

    /// Get raw pointer to positions for direct GPU access
    pub fn get_positions_ptr(&self) -> (*const f32, *const f32, *const f32) {
        (
            self.positions_x.as_ptr(),
            self.positions_y.as_ptr(),
            self.positions_z.as_ptr(),
        )
    }

    /// Get raw pointer to velocities for direct GPU access
    pub fn get_velocities_ptr(&self) -> (*const f32, *const f32, *const f32) {
        (
            self.velocities_x.as_ptr(),
            self.velocities_y.as_ptr(),
            self.velocities_z.as_ptr(),
        )
    }
}

/// Galaxy generation utilities
pub mod galaxy_generation {
    use super::*;
    use rand::{Rng, thread_rng};
    use std::f32::consts::PI;

    pub fn generate_spiral_galaxy(particle_count: usize, radius: f32, thickness: f32) -> Vec<Particle> {
        let mut rng = thread_rng();
        let mut particles = Vec::with_capacity(particle_count);
        
        for _ in 0..particle_count {
            // Generate spiral arms
            let arm = rng.gen_range(0..4); // 4 spiral arms
            let arm_angle = arm as f32 * PI / 2.0;
            
            // Distance from center (power law distribution)
            let r = radius * rng.gen::<f32>().powf(0.5);
            
            // Spiral angle
            let spiral_tightness = 3.0;
            let theta = arm_angle + spiral_tightness * (r / radius);
            
            // Position
            let x = r * theta.cos();
            let y = r * theta.sin();
            let z = rng.gen_range(-thickness..thickness) * (1.0 - r / radius);
            
            // Orbital velocity (Keplerian with dark matter correction)
            let v_orbital = (0.5 * radius / (r + 0.1)).sqrt() * 150.0;
            let vx = -v_orbital * theta.sin();
            let vy = v_orbital * theta.cos();
            let vz = rng.gen_range(-10.0..10.0);
            
            // Mass (most particles are similar mass)
            let mass = 1.0 + rng.gen::<f32>() * 0.1;
            
            particles.push(Particle::new(x, y, z, vx, vy, vz, mass));
        }
        
        particles
    }

    pub fn add_central_black_hole(particles: &mut Vec<Particle>, mass: f32) {
        particles.push(Particle::new(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, mass));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_particle_creation() {
        let particle = Particle::new(1.0, 2.0, 3.0, 0.1, 0.2, 0.3, 1.5);
        assert_eq!(particle.position, [1.0, 2.0, 3.0]);
        assert_eq!(particle.velocity, [0.1, 0.2, 0.3]);
        assert_eq!(particle.mass, 1.5);
    }

    #[test]
    fn test_soa_conversion() {
        let particles = vec![
            Particle::new(1.0, 2.0, 3.0, 0.1, 0.2, 0.3, 1.0),
            Particle::new(4.0, 5.0, 6.0, 0.4, 0.5, 0.6, 1.0),
        ];
        
        let soa = ParticleSystemSoA::from_particles(&particles);
        
        assert_eq!(soa.positions_x[0], 1.0);
        assert_eq!(soa.positions_y[1], 5.0);
        assert_eq!(soa.velocities_z[1], 0.6);
    }
}
