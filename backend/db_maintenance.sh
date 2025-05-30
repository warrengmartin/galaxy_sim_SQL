#!/bin/bash
# Database maintenance script for TimescaleDB galaxy simulation
# Usage: ./db_maintenance.sh [command]

DB_NAME="galaxy_sim"
DB_USER="gameplayer"
PORT=5433

# Color formatting
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color
BOLD='\033[1m'

function print_header {
    echo -e "${BOLD}╔════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║                                                    ║${NC}"
    echo -e "${BOLD}║        Galaxy Simulation Database Maintenance      ║${NC}"
    echo -e "${BOLD}║                                                    ║${NC}"
    echo -e "${BOLD}╚════════════════════════════════════════════════════╝${NC}"
    echo ""
}

function db_status {
    echo -e "${YELLOW}Checking TimescaleDB installation...${NC}"
    psql -U $DB_USER -d $DB_NAME -p $PORT -c "SELECT extname, extversion FROM pg_extension WHERE extname = 'timescaledb';"
    
    echo -e "\n${YELLOW}Checking hypertable status...${NC}"
    psql -U $DB_USER -d $DB_NAME -p $PORT -c "
        SELECT hypertable_schema, hypertable_name, 
               compression_enabled
        FROM timescaledb_information.hypertables
        WHERE hypertable_name = 'particle_snapshots';"
    
    echo -e "\n${YELLOW}Checking chunk information...${NC}"
    psql -U $DB_USER -d $DB_NAME -p $PORT -c "
        SELECT count(*) as chunk_count, 
               sum(pg_total_relation_size(format('%I.%I', chunk_schema, chunk_name))) as total_bytes,
               pg_size_pretty(sum(pg_total_relation_size(format('%I.%I', chunk_schema, chunk_name)))) as total_size
        FROM timescaledb_information.chunks
        WHERE hypertable_name = 'particle_snapshots';"
    
    echo -e "\n${YELLOW}Checking compression status...${NC}"
    psql -U $DB_USER -d $DB_NAME -p $PORT -c "
        SELECT 
          hypertable_name,
          compression_enabled,
          pg_size_pretty(pg_total_relation_size(format('%I.%I', hypertable_schema, hypertable_name))) as table_size
        FROM timescaledb_information.hypertables
        WHERE hypertable_name = 'particle_snapshots';"
    
    echo -e "\n${YELLOW}Checking row counts...${NC}"
    psql -U $DB_USER -d $DB_NAME -p $PORT -c "
        SELECT 
          (SELECT COUNT(*) FROM particles) as particle_count,
          (SELECT COUNT(*) FROM particle_snapshots) as snapshot_count;"
}

function compress_chunks {
    echo -e "${YELLOW}Manually compressing chunks...${NC}"
    psql -U $DB_USER -d $DB_NAME -p $PORT -c "
        SELECT chunk_schema, chunk_name, 
               pg_size_pretty(before_compression_total_bytes) as before_size,
               pg_size_pretty(after_compression_total_bytes) as after_size
        FROM compress_chunk(chunk, if_not_compressed => true) 
        FROM timescaledb_information.chunks 
        WHERE hypertable_name = 'particle_snapshots' 
        AND NOT compressed;"
    
    echo -e "\n${GREEN}Compression complete!${NC}"
}

function create_extension {
    echo -e "${YELLOW}Installing TimescaleDB extension...${NC}"
    psql -U $DB_USER -d $DB_NAME -p $PORT -c "CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;"
    echo -e "\n${GREEN}TimescaleDB extension installed!${NC}"
}

function create_indexes {
    echo -e "${YELLOW}Creating optimized indexes...${NC}"
    psql -U $DB_USER -d $DB_NAME -p $PORT -c "
        -- Index for frame-based queries
        CREATE INDEX IF NOT EXISTS idx_particle_snapshots_frame_particle 
        ON particle_snapshots (frame_number, particle_index);
        
        -- Index for time-based queries
        CREATE INDEX IF NOT EXISTS idx_particle_snapshots_time
        ON particle_snapshots (created_at DESC);
        
        -- Index for force/speed analysis
        CREATE INDEX IF NOT EXISTS idx_particle_snapshots_force
        ON particle_snapshots (force DESC);
        
        -- Index for speed analysis
        CREATE INDEX IF NOT EXISTS idx_particle_snapshots_speed
        ON particle_snapshots (speed DESC);"
    
    echo -e "\n${GREEN}Indexes created!${NC}"
}

function display_help {
    echo "Galaxy Simulation Database Maintenance Tool"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  status        - Show database and TimescaleDB status"
    echo "  compress      - Manually compress chunks"
    echo "  enable-auto   - Enable automatic compression policy (compress after 1 hour)"
    echo "  disable-auto  - Disable automatic compression policy"
    echo "  install       - Install TimescaleDB extension"
    echo "  indexes       - Create optimized indexes"
    echo "  reset         - Truncate all tables (WARNING: DESTRUCTIVE)"
    echo "  help          - Show this help message"
}

function reset_tables {
    echo -e "${RED}WARNING: This will delete all data in the particles and particle_snapshots tables!${NC}"
    read -p "Are you sure you want to continue? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Truncating tables...${NC}"
        psql -U $DB_USER -d $DB_NAME -p $PORT -c "
            TRUNCATE TABLE particles;
            TRUNCATE TABLE particle_snapshots;"
        echo -e "\n${GREEN}Tables reset!${NC}"
    else
        echo -e "${GREEN}Operation cancelled.${NC}"
    fi
}

function enable_auto_compression {
    echo -e "${YELLOW}Enabling automatic compression policy...${NC}"
    psql -U $DB_USER -d $DB_NAME -p $PORT -c "
        SELECT add_compression_policy('particle_snapshots', INTERVAL '1 hour', if_not_exists => TRUE);
    "
    echo -e "\n${GREEN}Automatic compression enabled! Chunks older than 1 hour will be compressed.${NC}"
}

function disable_auto_compression {
    echo -e "${YELLOW}Disabling automatic compression policy...${NC}"
    psql -U $DB_USER -d $DB_NAME -p $PORT -c "
        SELECT remove_compression_policy('particle_snapshots', if_exists => TRUE);
    "
    echo -e "\n${GREEN}Automatic compression disabled! You can still compress chunks manually.${NC}"
}

# Main script execution
print_header

case "$1" in
    status)
        db_status
        ;;
    compress)
        compress_chunks
        ;;
    install)
        create_extension
        ;;
    indexes)
        create_indexes
        ;;
    reset)
        reset_tables
        ;;
    enable-auto)
        enable_auto_compression
        ;;
    disable-auto)
        disable_auto_compression
        ;;
    help|*)
        display_help
        ;;
esac

exit 0
