#!/bin/bash

echo "======================================"
echo "Jellyfin Multi-Server Sync System Test"
echo "======================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Check all required files exist
echo "Test 1: Checking required files..."
files=("package.json" "config.json" "webhook-receiver.js" "sync-processor.js" "Dockerfile" "Dockerfile.sync" "docker-compose.yml")
all_exist=true
for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    echo -e "${GREEN}✓${NC} $file exists"
  else
    echo -e "${RED}✗${NC} $file missing"
    all_exist=false
  fi
done

# Test 2: Check directory structure
echo -e "\nTest 2: Checking directory structure..."
dirs=("data" "data/processed" "data/error" "data/unsupported" "data/offline")
for dir in "${dirs[@]}"; do
  if [ -d "$dir" ]; then
    echo -e "${GREEN}✓${NC} $dir exists"
  else
    echo -e "${RED}✗${NC} $dir missing"
    all_exist=false
  fi
done

# Test 3: Validate JSON syntax
echo -e "\nTest 3: Validating JSON files..."
if node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf-8'))" 2>/dev/null; then
  echo -e "${GREEN}✓${NC} package.json valid"
else
  echo -e "${RED}✗${NC} package.json invalid"
  all_exist=false
fi

if node -e "JSON.parse(require('fs').readFileSync('config.json', 'utf-8'))" 2>/dev/null; then
  echo -e "${GREEN}✓${NC} config.json valid"
else
  echo -e "${RED}✗${NC} config.json invalid"
  all_exist=false
fi

# Test 4: Check JavaScript syntax
echo -e "\nTest 4: Checking JavaScript syntax..."
if node --check webhook-receiver.js 2>/dev/null; then
  echo -e "${GREEN}✓${NC} webhook-receiver.js syntax OK"
else
  echo -e "${RED}✗${NC} webhook-receiver.js syntax error"
  all_exist=false
fi

if node --check sync-processor.js 2>/dev/null; then
  echo -e "${GREEN}✓${NC} sync-processor.js syntax OK"
else
  echo -e "${RED}✗${NC} sync-processor.js syntax error"
  all_exist=false
fi

# Test 5: Test webhook receiver functionality
echo -e "\nTest 5: Testing webhook receiver..."
node webhook-receiver.js &
RECEIVER_PID=$!
sleep 2

# Test health check
if curl -s http://localhost:9500/ | grep -q "running"; then
  echo -e "${GREEN}✓${NC} Webhook receiver health check passed"
else
  echo -e "${RED}✗${NC} Webhook receiver health check failed"
  all_exist=false
fi

# Test webhook POST
response=$(curl -s -X POST http://localhost:9500/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "ServerId": "test-server-id",
    "ServerName": "server1",
    "NotificationType": "PlaybackStop",
    "Name": "Test Episode",
    "ItemId": "test-item-id",
    "ItemType": "Episode",
    "PlaybackPositionTicks": 1000000,
    "NotificationUsername": "testuser"
  }')

if echo "$response" | grep -q "success"; then
  echo -e "${GREEN}✓${NC} Webhook POST endpoint working"
else
  echo -e "${RED}✗${NC} Webhook POST endpoint failed"
  all_exist=false
fi

# Check if file was created
if ls data/webhook_*.json 1> /dev/null 2>&1; then
  echo -e "${GREEN}✓${NC} Webhook file created successfully"
else
  echo -e "${RED}✗${NC} Webhook file not created"
  all_exist=false
fi

# Kill webhook receiver
kill $RECEIVER_PID 2>/dev/null
wait $RECEIVER_PID 2>/dev/null

# Test 6: Test sync processor loads correctly
echo -e "\nTest 6: Testing sync processor startup..."
timeout 2 node sync-processor.js >/dev/null 2>&1 &
SYNC_PID=$!
sleep 1

if ps -p $SYNC_PID > /dev/null 2>&1; then
  echo -e "${GREEN}✓${NC} Sync processor starts without errors"
  kill $SYNC_PID 2>/dev/null
  wait $SYNC_PID 2>/dev/null
else
  echo -e "${YELLOW}⚠${NC} Sync processor exited (may be normal if no files to process)"
fi

# Cleanup test files
echo -e "\nCleaning up test files..."
rm -f data/webhook_*.json 2>/dev/null

# Final summary
echo ""
echo "======================================"
if [ "$all_exist" = true ]; then
  echo -e "${GREEN}All tests passed!${NC}"
  echo "======================================"
  echo ""
  echo "Next steps:"
  echo "1. Update config.json with your Jellyfin server details"
  echo "2. Run: docker-compose up -d"
  echo "3. Configure webhooks in your Jellyfin instances"
  exit 0
else
  echo -e "${RED}Some tests failed!${NC}"
  echo "======================================"
  exit 1
fi
