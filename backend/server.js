// backend/server.js
// Express backend to receive particle data and insert into PostgreSQL with TimescaleDB

import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import pkg from 'pg';
import pgCopyStreams from 'pg-copy-streams';

const { Pool } = pkg;
const { from: copyFrom } = pgCopyStreams;

const app = express();
// Configure CORS properly to allow requests from your frontend
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(bodyParser.json({ limit: '100mb' })); // Allow larger payloads for batch inserts

// Connection pool with optimized settings
const pool = new Pool({
  user: 'gameplayer', // change as needed
  host: '/var/run/postgresql', // Use local socket instead of TCP
  database: 'galaxy_sim', // change as needed
  port: 5433, // Updated to PostgreSQL 17
  max: 20, // Max number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection can't be established
});

// Create and configure tables (run once at startup)
async function setupDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if TimescaleDB extension is installed
    const extensionCheck = await client.query(`
      SELECT COUNT(*) FROM pg_extension WHERE extname = 'timescaledb';
    `);
    
    if (extensionCheck.rows[0].count === '0') {
      console.log('TimescaleDB extension not found! Please install it with:');
      console.log('CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;');
    } else {
      console.log('✅ TimescaleDB extension found');
    }

    // Create initial particles table
    await client.query(`
      CREATE TABLE IF NOT EXISTS particles (
          id SERIAL PRIMARY KEY,
          x DOUBLE PRECISION,
          y DOUBLE PRECISION,
          z DOUBLE PRECISION,
          vx DOUBLE PRECISION,
          vy DOUBLE PRECISION,
          vz DOUBLE PRECISION
      );
    `);
    
    // Create time series table for per-frame particle data with optimized types
    await client.query(`
      CREATE TABLE IF NOT EXISTS particle_snapshots (
          id BIGSERIAL,
          frame_number INTEGER,
          particle_index INTEGER,
          x DOUBLE PRECISION,
          y DOUBLE PRECISION,
          z DOUBLE PRECISION,
          vx DOUBLE PRECISION,
          vy DOUBLE PRECISION,
          vz DOUBLE PRECISION,
          speed DOUBLE PRECISION,
          ax DOUBLE PRECISION,
          ay DOUBLE PRECISION,
          az DOUBLE PRECISION,
          force DOUBLE PRECISION,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (id, created_at)
      );
    `);
    
    // Convert to hypertable with optimized chunk size (1 day per chunk)
    await client.query(`
      SELECT create_hypertable('particle_snapshots', 'created_at', 
        chunk_time_interval => INTERVAL '1 day',
        if_not_exists => TRUE);
    `);
    
    // Create optimized index for queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_particle_frame ON particle_snapshots (frame_number, particle_index);
      CREATE INDEX IF NOT EXISTS idx_particle_time ON particle_snapshots (created_at DESC, frame_number);
    `);
    
    // Configure compression settings (but don't enable automatic policies)
    await client.query(`
      ALTER TABLE particle_snapshots SET (
        timescaledb.compress,
        timescaledb.compress_segmentby = 'frame_number,particle_index',
        timescaledb.compress_orderby = 'created_at'
      );
    `);
    
    // Remove any existing compression policies
    try {
      await client.query(`
        SELECT remove_compression_policy('particle_snapshots', if_exists => TRUE);
      `);
      console.log('✅ Removed existing compression policy');
    } catch (e) {
      console.log('ℹ️ No compression policy to remove');
    }
    
    // Still keep retention policy - drop chunks older than 30 days
    await client.query(`
      SELECT add_retention_policy('particle_snapshots', INTERVAL '30 days', if_not_exists => TRUE);
    `);
    
    await client.query('COMMIT');
    console.log('✅ Database setup complete!');
    console.log('✅ TimescaleDB hypertable configured with compression and retention policies');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Database setup error:', e);
  } finally {
    client.release();
  }
}

// Initialize database
setupDatabase().catch(console.error);

app.post('/particles', async (req, res) => {
  const particles = req.body; // Array of {x, y, z, vx, vy, vz}
  if (!Array.isArray(particles)) {
    return res.status(400).send('Invalid data');
  }
  
  // Skip if empty array
  if (particles.length === 0) {
    return res.sendStatus(200);
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Prepare batch insert using COPY FROM for maximum performance
    const pgFormat = particles.map(p => 
      `${p.x}\t${p.y}\t${p.z}\t${p.vx}\t${p.vy}\t${p.vz}`
    ).join('\n');

    // Use raw COPY command for maximum throughput
    const copyQuery = `
      COPY particles(x, y, z, vx, vy, vz)
      FROM STDIN WITH DELIMITER E'\\t'
    `;
    
    const copyStream = client.query(copyFrom(copyQuery));
    copyStream.write(pgFormat);
    copyStream.end();
    
    await client.query('COMMIT');
    
    console.log(`✅ Inserted ${particles.length} particles into database`);
    res.sendStatus(200);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Error inserting particles:', e);
    res.status(500).send(e.toString());
  } finally {
    client.release();
  }
});

// Accept per-frame, per-particle data in batch
app.post('/particle_snapshots', async (req, res) => {
  const snapshots = req.body; // Array of {frame_number, particle_index, x, y, z, vx, vy, vz, speed, ax, ay, az, force}
  if (!Array.isArray(snapshots)) {
    return res.status(400).send('Invalid data');
  }
  
  // Skip if empty array
  if (snapshots.length === 0) {
    return res.sendStatus(200);
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Using fast COPY method for large datasets
    const pgFormat = snapshots.map(s => 
      `${s.frame_number}\t${s.particle_index}\t${s.x}\t${s.y}\t${s.z}\t${s.vx}\t${s.vy}\t${s.vz}\t${s.speed}\t${s.ax}\t${s.ay}\t${s.az}\t${s.force}`
    ).join('\n');

    // Use raw COPY command for maximum throughput
    const copyQuery = `
      COPY particle_snapshots(
        frame_number, particle_index, x, y, z, 
        vx, vy, vz, speed, ax, ay, az, force
      )
      FROM STDIN WITH DELIMITER E'\\t'
    `;
    
    const copyStream = client.query(copyFrom(copyQuery));
    copyStream.write(pgFormat);
    copyStream.end();
    
    await client.query('COMMIT');
    
    console.log(`✅ Inserted ${snapshots.length} particle snapshots (frame: ${snapshots[0]?.frame_number || 'unknown'})`);
    res.sendStatus(200);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Error inserting particle snapshots:', e);
    res.status(500).send(e.toString());
  } finally {
    client.release();
  }
});

// Add monitoring endpoint to check database status
app.get('/db_status', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      // Check connection
      const connectionTest = await client.query('SELECT NOW() as time');
      
      // Get TimescaleDB version
      const versionResult = await client.query(`
        SELECT extversion FROM pg_extension WHERE extname = 'timescaledb';
      `);
      
      // Get hypertable info
      const hypertableInfo = await client.query(`
        SELECT hypertable_schema, hypertable_name, 
               compression_enabled, is_distributed
        FROM timescaledb_information.hypertables
        WHERE hypertable_name = 'particle_snapshots';
      `);
      
      // Get chunk info
      const chunkInfo = await client.query(`
        SELECT count(*) as chunk_count
        FROM timescaledb_information.chunks
        WHERE hypertable_name = 'particle_snapshots';
      `);
      
      // Get compression info
      const compressionInfo = await client.query(`
        SELECT 
          hypertable_name,
          compression_enabled,
          pg_size_pretty(hypertable_size) as table_size,
          pg_size_pretty(compressed_hypertable_size) as compressed_size
        FROM timescaledb_information.hypertables
        WHERE hypertable_name = 'particle_snapshots';
      `);
      
      // Get row counts
      const counts = await client.query(`
        SELECT 
          (SELECT COUNT(*) FROM particles) as particle_count,
          (SELECT COUNT(*) FROM particle_snapshots) as snapshot_count;
      `);
      
      res.json({
        status: 'connected',
        time: connectionTest.rows[0].time,
        timescaledb_version: versionResult.rows[0]?.extversion || 'not installed',
        hypertable: hypertableInfo.rows[0] || null,
        chunks: chunkInfo.rows[0] || null,
        compression: compressionInfo.rows[0] || null,
        counts: counts.rows[0] || null
      });
    } catch (e) {
      res.status(500).json({
        status: 'error',
        message: e.toString()
      });
    } finally {
      client.release();
    }
  } catch (e) {
    res.status(500).json({
      status: 'connection_failed',
      message: e.toString()
    });
  }
});

// Add a maintenance endpoint to trigger compression manually
app.post('/maintenance/compress', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      // Manually compress chunks
      const result = await client.query(`
        SELECT compress_chunk(chunk) 
        FROM timescaledb_information.chunks 
        WHERE hypertable_name = 'particle_snapshots' 
        AND NOT compressed;
      `);
      
      res.json({
        status: 'success',
        compressed_chunks: result.rowCount
      });
    } catch (e) {
      res.status(500).json({
        status: 'error',
        message: e.toString()
      });
    } finally {
      client.release();
    }
  } catch (e) {
    res.status(500).json({
      status: 'connection_failed',
      message: e.toString()
    });
  }
});

// Server startup with health check
const server = app.listen(3001, () => {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║                                                    ║');
  console.log('║        Galaxy Simulation Backend Server            ║');
  console.log('║       TimescaleDB-powered Data Collection          ║');
  console.log('║                                                    ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log('Server running on: http://localhost:3001');
  console.log('Database status: http://localhost:3001/db_status');
  console.log('\nPress Ctrl+C to stop the server');
}).on('error', (err) => {
  console.error('❌ Server error:', err.message);
  if (err.code === 'EADDRINUSE') {
    console.error('Port 3001 is already in use. Try killing any existing processes:');
    console.error('sudo lsof -i :3001');
    console.error('kill -9 <PID>');
  }
});
