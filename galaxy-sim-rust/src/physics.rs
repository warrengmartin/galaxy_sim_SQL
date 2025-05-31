use crate::particle_system::ParticleSystemSoA;
use wide::f32x4;

pub struct PhysicsEngine {
    particle_count: usize,
    forces_x: Vec<f32>,
    forces_y: Vec<f32>,
    forces_z: Vec<f32>,
    // Physics parameters
    gravity_constant: f32,
    softening_length: f32,
    dampening: f32,
}

impl PhysicsEngine {
    pub fn new(particle_count: usize) -> Self {
        Self {
            particle_count,
            forces_x: vec![0.0; particle_count],
            forces_y: vec![0.0; particle_count],
            forces_z: vec![0.0; particle_count],
            gravity_constant: 1.0,
            softening_length: 0.1,
            dampening: 0.999,
        }
    }

    /// Calculate gravitational forces and update particle velocities
    pub fn calculate_forces(&mut self, particles: &mut ParticleSystemSoA, dt: f32) {
        // Clear forces
        self.forces_x.fill(0.0);
        self.forces_y.fill(0.0);
        self.forces_z.fill(0.0);

        // Calculate forces using direct N-body calculation
        self.calculate_direct_nbody(particles);
        
        // Apply forces to update velocities
        self.apply_forces(particles, dt);
    }

    /// Direct N-body calculation
    fn calculate_direct_nbody(&mut self, particles: &ParticleSystemSoA) {
        for i in 0..self.particle_count {
            let pos_i_x = particles.positions_x[i];
            let pos_i_y = particles.positions_y[i];
            let pos_i_z = particles.positions_z[i];
            let mass_i = particles.masses[i];

            let mut force_x = 0.0f32;
            let mut force_y = 0.0f32;
            let mut force_z = 0.0f32;

            // Calculate force from all other particles
            for j in 0..self.particle_count {
                if i == j { continue; }
                
                let dx = particles.positions_x[j] - pos_i_x;
                let dy = particles.positions_y[j] - pos_i_y;
                let dz = particles.positions_z[j] - pos_i_z;
                
                let r_squared = dx * dx + dy * dy + dz * dz + 
                    self.softening_length * self.softening_length;
                let r = r_squared.sqrt();
                let force_magnitude = self.gravity_constant * mass_i * particles.masses[j] / r_squared;
                let inv_r = 1.0 / r;
                
                force_x += force_magnitude * dx * inv_r;
                force_y += force_magnitude * dy * inv_r;
                force_z += force_magnitude * dz * inv_r;
            }
            
            self.forces_x[i] = force_x;
            self.forces_y[i] = force_y;
            self.forces_z[i] = force_z;
        }
    }

    /// Apply calculated forces to update velocities using SIMD
    fn apply_forces(&self, particles: &mut ParticleSystemSoA, dt: f32) {
        // Process 4 particles at a time using SIMD
        let chunks = self.particle_count / 4;
        
        for i in 0..chunks {
            let base_idx = i * 4;

            // Load current velocities
            let vel_x = f32x4::new([
                particles.velocities_x[base_idx],
                particles.velocities_x[base_idx + 1],
                particles.velocities_x[base_idx + 2],
                particles.velocities_x[base_idx + 3],
            ]);
            let vel_y = f32x4::new([
                particles.velocities_y[base_idx],
                particles.velocities_y[base_idx + 1],
                particles.velocities_y[base_idx + 2],
                particles.velocities_y[base_idx + 3],
            ]);
            let vel_z = f32x4::new([
                particles.velocities_z[base_idx],
                particles.velocities_z[base_idx + 1],
                particles.velocities_z[base_idx + 2],
                particles.velocities_z[base_idx + 3],
            ]);

            // Load forces and masses
            let force_x = f32x4::new([
                self.forces_x[base_idx],
                self.forces_x[base_idx + 1],
                self.forces_x[base_idx + 2],
                self.forces_x[base_idx + 3],
            ]);
            let force_y = f32x4::new([
                self.forces_y[base_idx],
                self.forces_y[base_idx + 1],
                self.forces_y[base_idx + 2],
                self.forces_y[base_idx + 3],
            ]);
            let force_z = f32x4::new([
                self.forces_z[base_idx],
                self.forces_z[base_idx + 1],
                self.forces_z[base_idx + 2],
                self.forces_z[base_idx + 3],
            ]);
            let mass = f32x4::new([
                particles.masses[base_idx],
                particles.masses[base_idx + 1],
                particles.masses[base_idx + 2],
                particles.masses[base_idx + 3],
            ]);

            // Calculate acceleration: a = F/m
            let accel_x = force_x / mass;
            let accel_y = force_y / mass;
            let accel_z = force_z / mass;

            // Update velocity: v = v * dampening + a * dt
            let dt_vec = f32x4::splat(dt);
            let dampening_vec = f32x4::splat(self.dampening);
            
            let new_vel_x = vel_x * dampening_vec + accel_x * dt_vec;
            let new_vel_y = vel_y * dampening_vec + accel_y * dt_vec;
            let new_vel_z = vel_z * dampening_vec + accel_z * dt_vec;

            // Store back
            let new_vel_x_array = new_vel_x.to_array();
            let new_vel_y_array = new_vel_y.to_array();
            let new_vel_z_array = new_vel_z.to_array();
            
            particles.velocities_x[base_idx..base_idx + 4].copy_from_slice(&new_vel_x_array);
            particles.velocities_y[base_idx..base_idx + 4].copy_from_slice(&new_vel_y_array);
            particles.velocities_z[base_idx..base_idx + 4].copy_from_slice(&new_vel_z_array);
        }

        // Handle remaining particles
        for i in (chunks * 4)..self.particle_count {
            let mass = particles.masses[i];
            
            // Calculate acceleration
            let accel_x = self.forces_x[i] / mass;
            let accel_y = self.forces_y[i] / mass;
            let accel_z = self.forces_z[i] / mass;

            // Update velocity with dampening
            particles.velocities_x[i] = particles.velocities_x[i] * self.dampening + accel_x * dt;
            particles.velocities_y[i] = particles.velocities_y[i] * self.dampening + accel_y * dt;
            particles.velocities_z[i] = particles.velocities_z[i] * self.dampening + accel_z * dt;
        }
    }

    /// Set physics parameters
    pub fn set_gravity_constant(&mut self, g: f32) {
        self.gravity_constant = g;
    }

    pub fn set_softening_length(&mut self, epsilon: f32) {
        self.softening_length = epsilon;
    }

    pub fn set_dampening(&mut self, d: f32) {
        self.dampening = d.clamp(0.0, 1.0);
    }

    /// Get total gravitational potential energy
    pub fn get_potential_energy(&self, particles: &ParticleSystemSoA) -> f32 {
        let mut total_pe = 0.0;

        for i in 0..self.particle_count {
            for j in (i + 1)..self.particle_count {
                let dx = particles.positions_x[j] - particles.positions_x[i];
                let dy = particles.positions_y[j] - particles.positions_y[i];
                let dz = particles.positions_z[j] - particles.positions_z[i];

                let r = (dx * dx + dy * dy + dz * dz + self.softening_length * self.softening_length).sqrt();
                let pe = -self.gravity_constant * particles.masses[i] * particles.masses[j] / r;
                total_pe += pe;
            }
        }

        total_pe
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::particle_system::Particle;

    #[test]
    fn test_physics_engine_creation() {
        let physics = PhysicsEngine::new(100);
        assert_eq!(physics.particle_count, 100);
        assert_eq!(physics.forces_x.len(), 100);
    }

    #[test]
    fn test_force_calculation() {
        let particles = vec![
            Particle::new(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
            Particle::new(1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
        ];
        
        let mut particle_system = crate::particle_system::ParticleSystemSoA::from_particles(&particles);
        let mut physics = PhysicsEngine::new(2);
        
        physics.calculate_forces(&mut particle_system, 0.01);
        
        // Should have some force in x direction
        assert!(physics.forces_x[0] > 0.0); // Attracted to right
        assert!(physics.forces_x[1] < 0.0); // Attracted to left
    }
}
