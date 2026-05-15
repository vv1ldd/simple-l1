#!/bin/bash

# Simple-L1 Node Universal Installer
# "The Authority of Human Intent"

set -e

echo " "
echo "  ██████  ██ ███    ███ ██████  ██      ██████      ██      ██ "
echo " ██       ██ ████  ████ ██   ██ ██      ██          ██     ███ "
echo "  █████   ██ ██ ████ ██ ██████  ██      █████       ██      ██ "
echo "      ██  ██ ██  ██  ██ ██      ██      ██          ██      ██ "
echo "  ██████  ██ ██      ██ ██      ███████ ██████      ███████ ██ "
echo " "
echo "--- SOVEREIGN AUTHORITY RUNTIME INSTALLER ---"
echo " "

# --- AUTO-DETECTION & DEFAULTS ---
# Use environment variables if available, otherwise prompt (if TTY)
if [[ -z "$INSTALL_MODE" ]]; then
    if [ -t 0 ]; then
        echo "Select Installation Mode:"
        echo "1) Docker (Recommended - clean, easy updates)"
        echo "2) Native (Directly on server - requires Node.js 20+)"
        read -p "Choice [1-2]: " INSTALL_MODE
    else
        echo "NON-INTERACTIVE DETECTED: Defaulting to Native mode..."
        INSTALL_MODE="2"
    fi
fi

# --- DOCKER MODE ---
if [ "$INSTALL_MODE" == "1" ]; then
    if ! [ -x "$(command -v docker)" ]; then
      echo "Error: Docker is not installed." >&2
      exit 1
    fi
    mkdir -p simple-l1-node && cd simple-l1-node
    curl -sSL https://raw.githubusercontent.com/vv1ldd/simple-l1/main/docker-compose.yml -o docker-compose.yml
    if [[ -z "$NODE_NAME" ]]; then
        if [ -t 0 ]; then
            read -p "Enter node name: " NODE_NAME
        fi
        NODE_NAME=${NODE_NAME:-community-node-$(hostname)}
    fi
    export NODE_NAME=$NODE_NAME
    docker compose pull
    docker compose up -d
    echo "SUCCESS! Docker node is running."

# --- NATIVE MODE ---
else
    # Install Node.js if missing (Ubuntu/Debian)
    if ! [ -x "$(command -v node)" ]; then
        echo "Node.js not found. Installing Node.js 20 from NodeSource..."
        sudo apt-get update && sudo apt-get install -y ca-certificates curl gnupg
        sudo mkdir -p /etc/apt/keyrings
        curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
        NODE_MAJOR=20
        echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
        sudo apt-get update && sudo apt-get install nodejs -y
        echo "Node.js $(node -v) installed successfully."
    fi

    echo "Cloning repository..."
    if [ -d "simple-l1" ]; then
        echo "Repository already exists. Updating..."
        cd simple-l1 && git pull && cd node
    else
        git clone https://github.com/vv1ldd/simple-l1.git
        cd simple-l1/node
    fi
    npm install

    if [[ -z "$USER_NODE_NAME" ]]; then
        if [ -t 0 ]; then
            read -p "Enter node name: " USER_NODE_NAME
        fi
        USER_NODE_NAME=${USER_NODE_NAME:-native-node-$(hostname)}
    fi

    # Check if systemd is available
    if [ -d /run/systemd/system ] || [ -x "$(command -v systemctl)" ]; then
        echo "Setting up Systemd Service..."
    cat <<EOF | sudo tee /etc/systemd/system/simple-l1.service
[Unit]
Description=Simple-L1 Sovereign Node
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
ExecStart=$(which node) server.js
Restart=always
Environment=NODE_NAME=$USER_NODE_NAME
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
EOF

        sudo systemctl daemon-reload
        sudo systemctl enable simple-l1
        sudo systemctl start simple-l1
        echo "SUCCESS! Native node is running as a systemd service."
    else
        echo "SYSTEMD NOT DETECTED: Skipping service setup."
        echo "You can start the node manually: cd simple-l1/node && NODE_NAME=$USER_NODE_NAME node server.js"
    fi
fi

echo " "
echo "Dashboard: https://l1.wildflow.dev"
echo " "
