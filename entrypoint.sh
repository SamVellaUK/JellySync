#!/bin/sh
set -e

VOLUME_DIR="/volume"
CONFIG_FILE="$VOLUME_DIR/config.json"
DATA_DIR="$VOLUME_DIR/data"

# Create data directory if it doesn't exist
mkdir -p "$DATA_DIR"

# Check if config.json exists and is not empty
if [ ! -f "$CONFIG_FILE" ] || [ ! -s "$CONFIG_FILE" ]; then
    echo "============================================================"
    echo "  FIRST TIME SETUP REQUIRED"
    echo "============================================================"
    echo ""
    echo "No configuration file found!"
    echo ""
    echo "A template config.json has been created at:"
    echo "  $CONFIG_FILE"
    echo ""
    echo "Please:"
    echo "  1. Stop this container"
    echo "  2. Edit ./jellysync/config.json with your Jellyfin server details"
    echo "  3. Start the container again"
    echo ""
    echo "Example config.json:"
    echo ""
    cat /app/config.json.template
    echo ""
    echo "============================================================"
    echo "Container will now exit. Please configure and restart."
    echo "============================================================"

    # Copy template to the mounted volume location
    cp /app/config.json.template "$CONFIG_FILE"

    # Exit to wait for user configuration
    exit 0
fi

# Check if config is still the template (all placeholder values)
if grep -q "YOUR_API_KEY_HERE" "$CONFIG_FILE" || grep -q "SERVER_1_IP" "$CONFIG_FILE"; then
    echo "============================================================"
    echo "  CONFIGURATION INCOMPLETE"
    echo "============================================================"
    echo ""
    echo "Your config.json still contains placeholder values!"
    echo ""
    echo "Please edit ./jellysync/config.json and replace:"
    echo "  - YOUR_API_KEY_HERE with actual API keys"
    echo "  - SERVER_X_IP with actual server IPs"
    echo "  - server1, server2, etc. with your actual server names"
    echo ""
    echo "Then restart the container."
    echo ""
    echo "============================================================"
    exit 0
fi

# Config looks good, symlink it and start the application
ln -sf "$CONFIG_FILE" /app/config.json
ln -sf "$DATA_DIR" /app/data

echo "Configuration found. Starting JellySync..."
exec node index.js
