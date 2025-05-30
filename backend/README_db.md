# Galaxy Simulation TimescaleDB Setup

This document explains how to set up and optimize TimescaleDB for the galaxy simulation data collection.

## Initial Setup

### 1. Install TimescaleDB Extension

Connect to your PostgreSQL instance and run:

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
```

### 2. Create the Database

```sql
CREATE DATABASE galaxy_sim;
```

### 3. Connect to the Database and Verify TimescaleDB

Connect to the database and verify TimescaleDB is installed:

```sql
\c galaxy_sim
SELECT extname, extversion FROM pg_extension WHERE extname = 'timescaledb';
```

### 4. Start the Backend Server

The backend will automatically create and configure all required tables:

```bash
npm run server
```

## Database Structure

The system uses two main tables:

1. **particles** - Initial state of all particles
   - `id SERIAL PRIMARY KEY`
   - `x, y, z` - Position coordinates (DOUBLE PRECISION)
   - `vx, vy, vz` - Velocity components (DOUBLE PRECISION)

2. **particle_snapshots** - TimescaleDB hypertable for time-series data
   - `id BIGSERIAL`
   - `frame_number INTEGER`
   - `particle_index INTEGER`
   - `x, y, z` - Position coordinates (DOUBLE PRECISION)
   - `vx, vy, vz` - Velocity components (DOUBLE PRECISION)
   - `speed` - Scalar speed (DOUBLE PRECISION)
   - `ax, ay, az` - Acceleration components (DOUBLE PRECISION)
   - `force` - Magnitude of force (DOUBLE PRECISION)
   - `created_at TIMESTAMPTZ` - Timestamp (partition key)

## Optimizations

The server is configured with:

1. **Automatic Compression** - Data older than 1 hour is automatically compressed
2. **Data Retention** - Data older than 30 days is automatically removed
3. **Optimized Chunk Size** - 1 day per chunk for better query performance
4. **Batch Inserts** - Uses COPY protocol for maximum throughput
5. **Connection Pooling** - Optimized connection handling

## Useful Queries

### Check Table Sizes

```sql
SELECT
  hypertable_name,
  pg_size_pretty(hypertable_size) AS table_size,
  pg_size_pretty(compressed_hypertable_size) AS compressed_size
FROM timescaledb_information.hypertables
WHERE hypertable_name = 'particle_snapshots';
```

### Manually Compress Chunks

```sql
SELECT compress_chunk(chunk)
FROM timescaledb_information.chunks
WHERE hypertable_name = 'particle_snapshots' AND NOT compressed;
```

### Query for a Specific Time Range

```sql
SELECT 
  frame_number,
  avg(speed) as avg_speed,
  max(speed) as max_speed,
  avg(force) as avg_force
FROM particle_snapshots
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY frame_number
ORDER BY frame_number;
```

### Monitor Database Status

Visit the status endpoint: http://localhost:3001/db_status

## Tuning TimescaleDB

For very large datasets, consider these additional PostgreSQL configurations in postgresql.conf:

```
# Memory settings
shared_buffers = 4GB                  # 25% of available RAM
work_mem = 128MB                      # For complex sorts and hash operations
maintenance_work_mem = 1GB            # For maintenance operations
effective_cache_size = 12GB           # 75% of available RAM

# Write settings for bulk loads
wal_buffers = 16MB                    # Helps with write-heavy workloads
checkpoint_timeout = 30min            # Less frequent checkpoints
max_wal_size = 16GB                   # Larger WAL size for bulk loads

# TimescaleDB specific
timescaledb.max_background_workers = 8   # For parallel chunk operations
```
