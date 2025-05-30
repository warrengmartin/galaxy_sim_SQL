# Galaxy Simulation Database Schema

## Overview

The database schema is designed to efficiently store and query galaxy simulation data using TimescaleDB's time-series capabilities. This document provides a comprehensive overview of the database structure.

## Tables

### 1. `particles`

Stores the initial state of all particles in the simulation.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Primary key, auto-incrementing identifier |
| `x` | DOUBLE PRECISION | X-coordinate position |
| `y` | DOUBLE PRECISION | Y-coordinate position |
| `z` | DOUBLE PRECISION | Z-coordinate position |
| `vx` | DOUBLE PRECISION | X-component of velocity |
| `vy` | DOUBLE PRECISION | Y-component of velocity |
| `vz` | DOUBLE PRECISION | Z-component of velocity |

### 2. `particle_snapshots` (TimescaleDB Hypertable)

Stores the state of particles at each frame of the simulation, enabling time-series analysis.

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGSERIAL | Part of the primary key, auto-incrementing identifier |
| `frame_number` | INTEGER | Simulation frame number |
| `particle_index` | INTEGER | Index of the particle in the simulation |
| `x` | DOUBLE PRECISION | X-coordinate position |
| `y` | DOUBLE PRECISION | Y-coordinate position |
| `z` | DOUBLE PRECISION | Z-coordinate position |
| `vx` | DOUBLE PRECISION | X-component of velocity |
| `vy` | DOUBLE PRECISION | Y-component of velocity |
| `vz` | DOUBLE PRECISION | Z-component of velocity |
| `speed` | DOUBLE PRECISION | Magnitude of velocity vector |
| `ax` | DOUBLE PRECISION | X-component of acceleration |
| `ay` | DOUBLE PRECISION | Y-component of acceleration |
| `az` | DOUBLE PRECISION | Z-component of acceleration |
| `force` | DOUBLE PRECISION | Magnitude of acceleration/force vector |
| `created_at` | TIMESTAMPTZ | Timestamp of record creation, used for partitioning |

## Indexes

| Table | Index Name | Columns | Purpose |
|-------|------------|---------|---------|
| `particle_snapshots` | `idx_particle_frame` | `(frame_number, particle_index)` | Optimize queries by frame and particle |
| `particle_snapshots` | `idx_particle_time` | `(created_at DESC, frame_number)` | Optimize time-based queries |
| `particle_snapshots` | `idx_particle_snapshots_force` | `(force DESC)` | Optimize force-based analysis |
| `particle_snapshots` | `idx_particle_snapshots_speed` | `(speed DESC)` | Optimize speed-based analysis |

## TimescaleDB Configuration

| Setting | Value | Description |
|---------|-------|-------------|
| Chunk Time Interval | 1 day | Size of time-based chunks for optimal performance |
| Compression | Enabled | Automatically compresses data older than 1 hour |
| Compression Segment By | `frame_number, particle_index` | Optimizes compression by grouping related data |
| Compression Order By | `created_at` | Order within segments for optimal compression |
| Retention Policy | 30 days | Automatically removes data older than 30 days |

## Example Queries

### 1. Average Speed per Frame

```sql
SELECT 
  frame_number,
  avg(speed) as avg_speed,
  max(speed) as max_speed
FROM particle_snapshots
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY frame_number
ORDER BY frame_number;
```

### 2. Particle Trajectory

```sql
SELECT 
  frame_number, x, y, z, speed, force
FROM particle_snapshots
WHERE particle_index = 1000
  AND created_at > NOW() - INTERVAL '1 day'
ORDER BY frame_number;
```

### 3. Distribution of Forces

```sql
SELECT 
  width_bucket(force, 0, 100, 10) as bucket,
  count(*) as count,
  min(force) as min_force,
  max(force) as max_force
FROM particle_snapshots
WHERE frame_number = 100
GROUP BY bucket
ORDER BY bucket;
```

### 4. Highest Accelerating Particles

```sql
SELECT 
  particle_index, 
  avg(force) as avg_force,
  max(force) as max_force
FROM particle_snapshots
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY particle_index
ORDER BY max_force DESC
LIMIT 10;
```

### 5. Recent Simulation State

```sql
SELECT 
  max(frame_number) as latest_frame,
  count(distinct particle_index) as particle_count,
  avg(speed) as avg_speed,
  max(speed) as max_speed
FROM particle_snapshots
WHERE created_at > NOW() - INTERVAL '10 minutes';
```

## Performance Considerations

1. **Chunk Size**: The default 1-day chunk size works well for most simulations. For extremely large simulations, consider smaller chunks.

2. **Compression**: Compression is set to trigger after 1 hour. This can be adjusted based on your data patterns and storage requirements.

3. **Retention**: By default, data is retained for 30 days. Adjust this based on your analysis needs and storage capacity.

4. **Sampling**: For very large datasets, consider using TimescaleDB's approximate functions or implementing sampling in your queries:

```sql
SELECT *
FROM particle_snapshots
WHERE particle_index % 100 = 0  -- Sample 1% of particles
  AND frame_number % 10 = 0     -- Sample every 10th frame
LIMIT 1000;
```
