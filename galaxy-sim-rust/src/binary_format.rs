use std::io::{Write, Seek, SeekFrom};
use std::fs::{File, OpenOptions};
use bytemuck::{Pod, Zeroable, cast_slice, from_bytes, bytes_of};
use memmap2::{Mmap, MmapOptions};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum BinaryFormatError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Invalid file format")]
    InvalidFormat,
    #[error("Frame {0} not found")]
    FrameNotFound(u32),
    #[error("Memory mapping error")]
    MemoryMapError,
}

/// Binary file header for the galaxy simulation format
#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct SimulationHeader {
    pub magic: [u8; 8],           // "GALAXSIM"
    pub version: u32,
    pub particle_count: u32,
    pub frame_count: u32,
    pub frame_size_bytes: u32,
    pub dt: f32,                  // Time step
    pub total_time: f32,          // Total simulation time
    pub reserved: [u32; 8],       // Future use
}

impl SimulationHeader {
    pub const MAGIC: &'static [u8; 8] = b"GALAXSIM";
    pub const VERSION: u32 = 1;
    
    pub fn new(particle_count: u32, frame_count: u32, dt: f32) -> Self {
        let frame_size_bytes = particle_count * std::mem::size_of::<FrameParticle>() as u32;
        
        Self {
            magic: *Self::MAGIC,
            version: Self::VERSION,
            particle_count,
            frame_count,
            frame_size_bytes,
            dt,
            total_time: frame_count as f32 * dt,
            reserved: [0; 8],
        }
    }
    
    pub fn is_valid(&self) -> bool {
        self.magic == *Self::MAGIC && self.version == Self::VERSION
    }
}

/// Single particle data for a frame (optimized for memory layout)
#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct FrameParticle {
    pub position: [f32; 3],
    pub velocity: [f32; 3],
    pub acceleration: [f32; 3], // For advanced analysis
    pub mass: f32,
}

/// Frame header with metadata
#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct FrameHeader {
    pub frame_number: u32,
    pub timestamp: f32,
    pub particle_count: u32,
    pub checksum: u32, // Simple CRC for data integrity
}

/// Memory-mapped binary writer for recording simulations
pub struct SimulationWriter {
    file: File,
    header: SimulationHeader,
    frames_written: u32,
}

impl SimulationWriter {
    pub fn new(filename: &str, particle_count: u32, estimated_frames: u32, dt: f32) -> Result<Self, BinaryFormatError> {
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(filename)?;
        
        // Write placeholder header (will be updated when closed)
        let header = SimulationHeader::new(particle_count, 0, dt);
        file.write_all(bytes_of(&header))?;
        
        // Pre-allocate space for better performance
        let total_size = std::mem::size_of::<SimulationHeader>() as u64 
            + estimated_frames as u64 * (
                std::mem::size_of::<FrameHeader>() as u64 
                + particle_count as u64 * std::mem::size_of::<FrameParticle>() as u64
            );
        file.set_len(total_size)?;
        
        Ok(Self {
            file,
            header,
            frames_written: 0,
        })
    }
    
    pub fn write_frame(&mut self, frame_number: u32, timestamp: f32, particles: &[FrameParticle]) -> Result<(), BinaryFormatError> {
        if particles.len() != self.header.particle_count as usize {
            return Err(BinaryFormatError::InvalidFormat);
        }
        
        // Create frame header
        let frame_header = FrameHeader {
            frame_number,
            timestamp,
            particle_count: particles.len() as u32,
            checksum: calculate_checksum(cast_slice(particles)),
        };
        
        // Write frame header
        self.file.write_all(bytes_of(&frame_header))?;
        
        // Write particle data
        self.file.write_all(cast_slice(particles))?;
        
        self.frames_written += 1;
        
        Ok(())
    }
    
    pub fn finalize(mut self) -> Result<(), BinaryFormatError> {
        // Update header with actual frame count
        self.header.frame_count = self.frames_written;
        self.header.total_time = self.frames_written as f32 * self.header.dt;
        
        // Seek to beginning and write final header
        self.file.seek(SeekFrom::Start(0))?;
        self.file.write_all(bytes_of(&self.header))?;
        
        // Truncate file to actual size
        let actual_size = std::mem::size_of::<SimulationHeader>() as u64
            + self.frames_written as u64 * (
                std::mem::size_of::<FrameHeader>() as u64
                + self.header.particle_count as u64 * std::mem::size_of::<FrameParticle>() as u64
            );
        self.file.set_len(actual_size)?;
        
        Ok(())
    }
}

/// Memory-mapped binary reader for ultra-fast playback
pub struct SimulationReader {
    _file: File,
    mmap: Mmap,
    header: SimulationHeader,
    frame_offsets: Vec<u64>,
}

impl SimulationReader {
    pub fn new(filename: &str) -> Result<Self, BinaryFormatError> {
        let file = File::open(filename)?;
        let mmap = unsafe { MmapOptions::new().map(&file)? };
        
        // Read header
        if mmap.len() < std::mem::size_of::<SimulationHeader>() {
            return Err(BinaryFormatError::InvalidFormat);
        }
        
        let header: SimulationHeader = *from_bytes(&mmap[..std::mem::size_of::<SimulationHeader>()]);
        
        if !header.is_valid() {
            return Err(BinaryFormatError::InvalidFormat);
        }
        
        // Calculate frame offsets for O(1) access
        let mut frame_offsets = Vec::with_capacity(header.frame_count as usize);
        let mut offset = std::mem::size_of::<SimulationHeader>() as u64;
        
        for _ in 0..header.frame_count {
            frame_offsets.push(offset);
            offset += std::mem::size_of::<FrameHeader>() as u64;
            offset += header.particle_count as u64 * std::mem::size_of::<FrameParticle>() as u64;
        }
        
        Ok(Self {
            _file: file,
            mmap,
            header,
            frame_offsets,
        })
    }
    
    pub fn get_header(&self) -> &SimulationHeader {
        &self.header
    }
    
    /// Get frame data with zero-copy access
    pub fn get_frame(&self, frame_index: u32) -> Result<&[FrameParticle], BinaryFormatError> {
        if frame_index >= self.header.frame_count {
            return Err(BinaryFormatError::FrameNotFound(frame_index));
        }
        
        let offset = self.frame_offsets[frame_index as usize];
        let frame_header_size = std::mem::size_of::<FrameHeader>();
        let particle_data_offset = offset as usize + frame_header_size;
        let particle_data_size = self.header.particle_count as usize * std::mem::size_of::<FrameParticle>();
        
        let particle_bytes = &self.mmap[particle_data_offset..particle_data_offset + particle_data_size];
        Ok(cast_slice(particle_bytes))
    }
    
    /// Get frame header
    pub fn get_frame_header(&self, frame_index: u32) -> Result<&FrameHeader, BinaryFormatError> {
        if frame_index >= self.header.frame_count {
            return Err(BinaryFormatError::FrameNotFound(frame_index));
        }
        
        let offset = self.frame_offsets[frame_index as usize] as usize;
        let frame_header_bytes = &self.mmap[offset..offset + std::mem::size_of::<FrameHeader>()];
        Ok(from_bytes(frame_header_bytes))
    }
    
    /// Get positions for a specific frame as a flat array (for GPU upload)
    pub fn get_frame_positions(&self, frame_index: u32) -> Result<Vec<f32>, BinaryFormatError> {
        let particles = self.get_frame(frame_index)?;
        let mut positions = Vec::with_capacity(particles.len() * 3);
        
        for particle in particles {
            positions.extend_from_slice(&particle.position);
        }
        
        Ok(positions)
    }
    
    /// Get interpolated positions between two frames for smooth playback
    pub fn get_interpolated_positions(&self, frame_a: u32, frame_b: u32, t: f32) -> Result<Vec<f32>, BinaryFormatError> {
        let particles_a = self.get_frame(frame_a)?;
        let particles_b = self.get_frame(frame_b)?;
        
        if particles_a.len() != particles_b.len() {
            return Err(BinaryFormatError::InvalidFormat);
        }
        
        let mut positions = Vec::with_capacity(particles_a.len() * 3);
        
        for (pa, pb) in particles_a.iter().zip(particles_b.iter()) {
            for i in 0..3 {
                let interpolated = pa.position[i] * (1.0 - t) + pb.position[i] * t;
                positions.push(interpolated);
            }
        }
        
        Ok(positions)
    }
}

/// Calculate simple checksum for data integrity
fn calculate_checksum(data: &[u8]) -> u32 {
    data.iter().fold(0u32, |acc, &byte| {
        acc.wrapping_add(byte as u32)
    })
}

/// Conversion utilities
impl From<crate::particle_system::Particle> for FrameParticle {
    fn from(particle: crate::particle_system::Particle) -> Self {
        Self {
            position: particle.position,
            velocity: particle.velocity,
            acceleration: [0.0; 3], // Will be calculated during simulation
            mass: particle.mass,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_header_validity() {
        let header = SimulationHeader::new(1000, 500, 0.01);
        assert!(header.is_valid());
        assert_eq!(header.particle_count, 1000);
        assert_eq!(header.frame_count, 500);
    }

    #[test]
    fn test_binary_format() {
        let filename = "test_simulation.bin";
        
        // Write test data
        {
            let mut writer = SimulationWriter::new(filename, 2, 2, 0.01).unwrap();
            
            let particles = vec![
                FrameParticle {
                    position: [1.0, 2.0, 3.0],
                    velocity: [0.1, 0.2, 0.3],
                    acceleration: [0.0; 3],
                    mass: 1.0,
                },
                FrameParticle {
                    position: [4.0, 5.0, 6.0],
                    velocity: [0.4, 0.5, 0.6],
                    acceleration: [0.0; 3],
                    mass: 1.0,
                },
            ];
            
            writer.write_frame(0, 0.0, &particles).unwrap();
            writer.write_frame(1, 0.01, &particles).unwrap();
            writer.finalize().unwrap();
        }
        
        // Read test data
        {
            let reader = SimulationReader::new(filename).unwrap();
            assert_eq!(reader.get_header().particle_count, 2);
            assert_eq!(reader.get_header().frame_count, 2);
            
            let frame_0 = reader.get_frame(0).unwrap();
            assert_eq!(frame_0.len(), 2);
            assert_eq!(frame_0[0].position[0], 1.0);
        }
        
        // Cleanup
        fs::remove_file(filename).unwrap();
    }
}
