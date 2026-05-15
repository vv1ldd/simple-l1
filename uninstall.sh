#!/bin/bash

# Simple-L1 Sovereign Cleanup Tool
# "Sovereignty means the right to leave."

echo "--- SOVEREIGN CLEANUP INITIATED ---"

# 1. Stop Systemd Service (if exists)
if systemctl is-active --quiet simple-l1; then
    echo "Stopping simple-l1 service..."
    sudo systemctl stop simple-l1
    sudo systemctl disable simple-l1
fi

if [ -f /etc/systemd/system/simple-l1.service ]; then
    echo "Removing systemd service file..."
    sudo rm /etc/systemd/system/simple-l1.service
    sudo systemctl daemon-reload
fi

# 2. Kill orphan processes
echo "Checking for orphan node processes..."
pkill -f "node server.js" || true

# 3. Remove Installation Directory
INSTALL_DIR="$HOME/simple-l1"
if [ -d "$INSTALL_DIR" ]; then
    echo "Found installation at $INSTALL_DIR"
    
    # Check if we are in a non-interactive shell (pipe)
    if [ ! -t 0 ]; then
        echo "Non-interactive shell detected. To remove the directory, please run the script manually or use rm -rf $INSTALL_DIR"
    else
        read -p "Do you want to delete ALL data (including identity and ledger)? [y/N]: " CONFIRM
        if [[ "$CONFIRM" =~ ^[Yy]$ ]]; then
            echo "Removing project directory and all data..."
            rm -rf "$INSTALL_DIR"
        fi
    fi
fi

echo "--- CLEANUP COMPLETE. SYSTEM IS PURE. ---"
