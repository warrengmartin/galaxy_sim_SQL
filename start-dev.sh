#!/bin/bash
# Start both frontend and backend servers

# Colors for better visibility
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to clean up processes on script exit
cleanup() {
    echo -e "${YELLOW}Shutting down services...${NC}"
    
    # Kill backend if PID file exists
    if [ -f "backend.pid" ]; then
        BACKEND_PID=$(cat backend.pid)
        if ps -p $BACKEND_PID > /dev/null; then
            echo -e "${YELLOW}Stopping backend server (PID $BACKEND_PID)...${NC}"
            kill $BACKEND_PID 2>/dev/null || kill -9 $BACKEND_PID 2>/dev/null
        fi
        rm backend.pid 2>/dev/null
    fi
    
    # Extra: If port 3001 is still open, try to kill any node process using it
    if netstat -tuln | grep -q ":3001 "; then
        echo -e "${YELLOW}Port 3001 still open after cleanup. Attempting force kill...${NC}"
        PID_TO_KILL=$(lsof -i :3001 -t 2>/dev/null | head -n 1)
        if [ ! -z "$PID_TO_KILL" ]; then
            echo -e "${YELLOW}Killing process on port 3001 (PID $PID_TO_KILL)...${NC}"
            kill -9 $PID_TO_KILL 2>/dev/null
        fi
    fi
    
    # Kill frontend if PID file exists
    if [ -f "frontend.pid" ]; then
        FRONTEND_PID=$(cat frontend.pid)
        if ps -p $FRONTEND_PID > /dev/null; then
            echo -e "${YELLOW}Stopping frontend server (PID $FRONTEND_PID)...${NC}"
            kill $FRONTEND_PID 2>/dev/null || kill -9 $FRONTEND_PID 2>/dev/null
        fi
        rm frontend.pid 2>/dev/null
    fi
    
    echo -e "${GREEN}All services stopped.${NC}"
}

# Register cleanup function to run on script exit
trap cleanup EXIT INT TERM

# Set the base directory
BASE_DIR="/home/gameplayer/github-projects/galaxy_sim_SQL"
cd "$BASE_DIR"

# Check if port 3001 is already in use
if netstat -tuln | grep -q ":3001 "; then
    echo -e "${RED}Port 3001 is already in use! The backend might already be running.${NC}"
    echo -e "${YELLOW}To kill the existing process:${NC}"
    echo -e "  ${GREEN}sudo lsof -i :3001${NC}"
    echo -e "  ${GREEN}kill -9 <PID>${NC}"
    
    # Check if it's our backend process from a previous run
    if [ -f "$BASE_DIR/backend.pid" ]; then
        OLD_PID=$(cat "$BASE_DIR/backend.pid")
        if ps -p "$OLD_PID" > /dev/null; then
            echo -e "${YELLOW}Found previous backend server process (PID $OLD_PID)${NC}"
            read -p "Kill the existing process? (y/n) " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                echo -e "${YELLOW}Killing process $OLD_PID...${NC}"
                kill -15 "$OLD_PID"
                sleep 1
                # Force kill if still running
                if ps -p "$OLD_PID" > /dev/null; then
                    kill -9 "$OLD_PID"
                fi
                echo -e "${GREEN}Process terminated.${NC}"
            else
                echo -e "${RED}Exiting. Cannot start new backend server while port 3001 is in use.${NC}"
                exit 1
            fi
        fi
    else
        echo -e "${RED}Exiting. Please free port 3001 before starting.${NC}"
        read -p "Press enter to continue anyway (this might not work)" 
    fi
fi

# Start backend server directly in background without relying on terminal emulator
echo -e "${YELLOW}Starting backend server...${NC}"

# Always use background mode with logging - more reliable
cd "$BASE_DIR"
node backend/server.js > backend.log 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > backend.pid

# Verify the server started properly
echo -e "${YELLOW}Backend server started with PID $BACKEND_PID${NC}"
echo -e "${YELLOW}Checking server startup...${NC}"

# Wait for the server to be available
MAX_RETRIES=10
RETRY_COUNT=0
SERVER_READY=false

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if grep -q "Server running on" backend.log; then
        SERVER_READY=true
        break
    fi
    echo -e "${YELLOW}Waiting for backend to initialize ($((RETRY_COUNT + 1))/$MAX_RETRIES)...${NC}"
    sleep 1
    RETRY_COUNT=$((RETRY_COUNT + 1))
done

if [ "$SERVER_READY" = true ]; then
    echo -e "${GREEN}Backend server started successfully!${NC}"
    echo -e "${GREEN}Server log:${NC}"
    tail -5 backend.log
else
    echo -e "${RED}Backend server failed to start properly!${NC}"
    echo -e "${RED}Check backend.log for errors${NC}"
    cat backend.log
fi

# Start frontend dev server
echo -e "${YELLOW}Starting frontend...${NC}"

# Check if we're in a terminal that supports job control
if [ -t 1 ]; then
    # Start frontend in foreground, so that Ctrl+C will stop both frontend and backend
    npm run dev
else
    # If not in an interactive terminal, start frontend in background too
    npm run dev > frontend.log 2>&1 &
    FRONTEND_PID=$!
    echo $FRONTEND_PID > frontend.pid
    echo -e "${GREEN}Frontend started with PID $FRONTEND_PID${NC}"
    echo -e "${GREEN}Check frontend.log for output${NC}"
    
    # Register exit handler to clean up both processes
    trap 'kill $BACKEND_PID $FRONTEND_PID 2>/dev/null' EXIT
    
    # Keep script running
    echo -e "${GREEN}Both services are running. Press Ctrl+C to stop.${NC}"
    tail -f backend.log
fi
