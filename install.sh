#!/bin/bash

# Simple-L1 Node Installer
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

# 1. Check Dependencies
if ! [ -x "$(command -v docker)" ]; then
  echo "Error: Docker is not installed. Please install Docker first." >&2
  exit 1
fi

# 2. Setup Directory
mkdir -p simple-l1-node
cd simple-l1-node

# 3. Download Docker Compose
echo "[1/3] Downloading network configuration..."
curl -sSL https://raw.githubusercontent.com/vv1ldd/simple-l1/main/docker-compose.yml -o docker-compose.yml

# 4. Optional: Custom Node Name
read -p "Enter node name [leave empty for auto-naming]: " USER_NODE_NAME
if [ -z "$USER_NODE_NAME" ]; then
  USER_NODE_NAME="community-node"
fi

# 5. Launch
echo "[2/3] Pulling sovereign runtime image..."
export NODE_NAME=$USER_NODE_NAME
docker compose pull

echo "[3/3] Launching node..."
docker compose up -d

echo " "
echo "SUCCESS! Your node is now part of the Simple-L1 Fabric."
echo "View status: docker compose logs -f sl1-node"
echo "Dashboard: https://l1.wildflow.dev"
echo " "
