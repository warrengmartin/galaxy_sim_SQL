// backend/server.js
// Express backend to receive particle data and insert into PostgreSQL

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); // Allow large payloads

// Update these values for your PostgreSQL setup
const pool = new Pool({
  user: 'postgres', // change as needed
  host: 'localhost',
  database: 'galaxy_sim', // change as needed
  password: 'postgres', // change as needed
  port: 5432,
});

// Create table if not exists (run once at startup)
const createTableQuery = `
CREATE TABLE IF NOT EXISTS particles (
    id SERIAL PRIMARY KEY,
    x FLOAT,
    y FLOAT,
    z FLOAT,
    vx FLOAT,
    vy FLOAT,
    vz FLOAT
);
`;
pool.query(createTableQuery).catch(console.error);

// Create time series table for per-frame particle data
const createSnapshotsTableQuery = `
CREATE TABLE IF NOT EXISTS particle_snapshots (
    id SERIAL PRIMARY KEY,
    frame_number INT,
    particle_index INT,
    x FLOAT,
    y FLOAT,
    z FLOAT,
    vx FLOAT,
    vy FLOAT,
    vz FLOAT,
    speed FLOAT,
    ax FLOAT,
    ay FLOAT,
    az FLOAT,
    force FLOAT,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_particle_frame ON particle_snapshots (particle_index, frame_number);
`;
pool.query(createSnapshotsTableQuery).catch(console.error);

app.post('/particles', async (req, res) => {
  const particles = req.body; // Array of {x, y, z, vx, vy, vz}
  if (!Array.isArray(particles)) {
    return res.status(400).send('Invalid data');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const insertQuery = 'INSERT INTO particles (x, y, z, vx, vy, vz) VALUES ($1, $2, $3, $4, $5, $6)';
    for (const p of particles) {
      await client.query(insertQuery, [p.x, p.y, p.z, p.vx, p.vy, p.vz]);
    }
    await client.query('COMMIT');
    res.sendStatus(200);
  } catch (e) {
    await client.query('ROLLBACK');
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const insertQuery = `INSERT INTO particle_snapshots
      (frame_number, particle_index, x, y, z, vx, vy, vz, speed, ax, ay, az, force)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`;
    for (const s of snapshots) {
      await client.query(insertQuery, [
        s.frame_number, s.particle_index, s.x, s.y, s.z,
        s.vx, s.vy, s.vz, s.speed,
        s.ax, s.ay, s.az, s.force
      ]);
    }
    await client.query('COMMIT');
    res.sendStatus(200);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).send(e.toString());
  } finally {
    client.release();
  }
});

app.listen(3000, () => console.log('Backend server running on port 3000'));
