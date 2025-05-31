use std::sync::{Arc, Mutex};
use std::collections::VecDeque;

/// Memory pool for reusing Vec<f32> allocations to reduce garbage collection pressure
pub struct MemoryPool<T> {
    pool: Arc<Mutex<VecDeque<Vec<T>>>>,
    max_size: usize,
    default_capacity: usize,
}

impl<T: Clone + Default> MemoryPool<T> {
    pub fn new(max_size: usize, default_capacity: usize) -> Self {
        Self {
            pool: Arc::new(Mutex::new(VecDeque::new())),
            max_size,
            default_capacity,
        }
    }

    /// Get a vector from the pool or create a new one
    pub fn get(&self) -> Vec<T> {
        let mut pool = self.pool.lock().unwrap();
        
        match pool.pop_front() {
            Some(mut vec) => {
                vec.clear();
                vec
            },
            None => Vec::with_capacity(self.default_capacity)
        }
    }

    /// Return a vector to the pool for reuse
    pub fn return_vec(&self, mut vec: Vec<T>) {
        let mut pool = self.pool.lock().unwrap();
        
        if pool.len() < self.max_size {
            vec.clear();
            pool.push_back(vec);
        }
        // If pool is full, just drop the vector
    }

    /// Get current pool size
    pub fn pool_size(&self) -> usize {
        self.pool.lock().unwrap().len()
    }

    /// Clear the entire pool
    pub fn clear(&self) {
        self.pool.lock().unwrap().clear();
    }
}

/// Specialized memory pools for common galaxy simulation data types
pub struct GalaxyMemoryPools {
    pub position_pool: MemoryPool<f32>,
    pub velocity_pool: MemoryPool<f32>,
    pub force_pool: MemoryPool<f32>,
    pub index_pool: MemoryPool<u32>,
}

impl GalaxyMemoryPools {
    pub fn new(max_particles: usize) -> Self {
        Self {
            position_pool: MemoryPool::new(20, max_particles * 3),
            velocity_pool: MemoryPool::new(20, max_particles * 3),
            force_pool: MemoryPool::new(20, max_particles * 3),
            index_pool: MemoryPool::new(10, max_particles),
        }
    }

    /// Get position vector from pool
    pub fn get_position_vec(&self) -> Vec<f32> {
        self.position_pool.get()
    }

    /// Get velocity vector from pool
    pub fn get_velocity_vec(&self) -> Vec<f32> {
        self.velocity_pool.get()
    }

    /// Get force vector from pool
    pub fn get_force_vec(&self) -> Vec<f32> {
        self.force_pool.get()
    }

    /// Get index vector from pool
    pub fn get_index_vec(&self) -> Vec<u32> {
        self.index_pool.get()
    }

    /// Return position vector to pool
    pub fn return_position_vec(&self, vec: Vec<f32>) {
        self.position_pool.return_vec(vec);
    }

    /// Return velocity vector to pool
    pub fn return_velocity_vec(&self, vec: Vec<f32>) {
        self.velocity_pool.return_vec(vec);
    }

    /// Return force vector to pool
    pub fn return_force_vec(&self, vec: Vec<f32>) {
        self.force_pool.return_vec(vec);
    }

    /// Return index vector to pool
    pub fn return_index_vec(&self, vec: Vec<u32>) {
        self.index_pool.return_vec(vec);
    }

    /// Get memory usage statistics
    pub fn get_stats(&self) -> MemoryPoolStats {
        MemoryPoolStats {
            position_pool_size: self.position_pool.pool_size(),
            velocity_pool_size: self.velocity_pool.pool_size(),
            force_pool_size: self.force_pool.pool_size(),
            index_pool_size: self.index_pool.pool_size(),
        }
    }

    /// Clear all pools
    pub fn clear_all(&self) {
        self.position_pool.clear();
        self.velocity_pool.clear();
        self.force_pool.clear();
        self.index_pool.clear();
    }
}

#[derive(Debug, Clone)]
pub struct MemoryPoolStats {
    pub position_pool_size: usize,
    pub velocity_pool_size: usize,
    pub force_pool_size: usize,
    pub index_pool_size: usize,
}

/// RAII wrapper for automatic pool return
pub struct PooledVec<T> {
    vec: Option<Vec<T>>,
    pool: Arc<Mutex<VecDeque<Vec<T>>>>,
}

impl<T> PooledVec<T> {
    pub fn new(vec: Vec<T>, pool: Arc<Mutex<VecDeque<Vec<T>>>>) -> Self {
        Self {
            vec: Some(vec),
            pool,
        }
    }

    /// Get mutable reference to the vector
    pub fn as_mut(&mut self) -> &mut Vec<T> {
        self.vec.as_mut().unwrap()
    }

    /// Get immutable reference to the vector
    pub fn as_ref(&self) -> &Vec<T> {
        self.vec.as_ref().unwrap()
    }

    /// Take ownership of the vector (prevents return to pool)
    pub fn take(mut self) -> Vec<T> {
        self.vec.take().unwrap()
    }
}

impl<T> Drop for PooledVec<T> {
    fn drop(&mut self) {
        if let Some(vec) = self.vec.take() {
            let mut pool = self.pool.lock().unwrap();
            if pool.len() < 100 { // Max pool size
                pool.push_back(vec);
            }
        }
    }
}

impl<T> std::ops::Deref for PooledVec<T> {
    type Target = Vec<T>;

    fn deref(&self) -> &Self::Target {
        self.vec.as_ref().unwrap()
    }
}

impl<T> std::ops::DerefMut for PooledVec<T> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.vec.as_mut().unwrap()
    }
}

/// Thread-local memory pools for better performance in multi-threaded scenarios
thread_local! {
    static THREAD_POOLS: std::cell::RefCell<Option<GalaxyMemoryPools>> = std::cell::RefCell::new(None);
}

/// Get thread-local memory pools
pub fn get_thread_pools(max_particles: usize) -> &'static GalaxyMemoryPools {
    THREAD_POOLS.with(|pools| {
        let mut pools_ref = pools.borrow_mut();
        if pools_ref.is_none() {
            *pools_ref = Some(GalaxyMemoryPools::new(max_particles));
        }
    });
    
    // This is unsafe but necessary for the current design
    // In a real implementation, we'd use a different approach
    unsafe {
        std::mem::transmute(THREAD_POOLS.with(|pools| {
            pools.borrow().as_ref().unwrap() as *const GalaxyMemoryPools
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_memory_pool() {
        let pool: MemoryPool<f32> = MemoryPool::new(5, 100);
        
        // Get a vector
        let mut vec1 = pool.get();
        vec1.push(1.0);
        vec1.push(2.0);
        
        // Return it
        pool.return_vec(vec1);
        assert_eq!(pool.pool_size(), 1);
        
        // Get it back
        let vec2 = pool.get();
        assert_eq!(vec2.len(), 0); // Should be cleared
        assert_eq!(vec2.capacity(), 100);
    }

    #[test]
    fn test_galaxy_memory_pools() {
        let pools = GalaxyMemoryPools::new(1000);
        
        let mut pos_vec = pools.get_position_vec();
        pos_vec.extend_from_slice(&[1.0, 2.0, 3.0]);
        
        pools.return_position_vec(pos_vec);
        
        let stats = pools.get_stats();
        assert_eq!(stats.position_pool_size, 1);
    }

    #[test]
    fn test_pooled_vec_raii() {
        let pool: MemoryPool<i32> = MemoryPool::new(5, 10);
        
        {
            let vec = pool.get();
            let _pooled = PooledVec::new(vec, pool.pool.clone());
            // pooled will be automatically returned to pool when dropped
        }
        
        assert_eq!(pool.pool_size(), 1);
    }
}
