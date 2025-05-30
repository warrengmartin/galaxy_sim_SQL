# PostgreSQL setup for galaxy_sim_SQL

# 1. Create the database (run in psql or your SQL client):
# CREATE DATABASE galaxy_sim;

# 2. (Optional) Create a dedicated user:
# CREATE USER galaxy_user WITH PASSWORD 'yourpassword';
# GRANT ALL PRIVILEGES ON DATABASE galaxy_sim TO galaxy_user;

# 3. The backend will auto-create the 'particles' table if it does not exist.

# 4. To clear the table (optional):
# TRUNCATE TABLE particles;

# 5. To inspect the data:
# SELECT * FROM particles LIMIT 100;

# 6. If you want to drop the table:
# DROP TABLE particles;

# 7. The backend expects the following columns:
#   id SERIAL PRIMARY KEY
#   x FLOAT
#   y FLOAT
#   z FLOAT
#   vx FLOAT
#   vy FLOAT
#   vz FLOAT

# 8. The backend runs on port 3000 by default.
