#!/bin/bash

# Automated iOS rebuild script for native module development
set -e

echo "🚀 D2D Sales Tracker - iOS Native Module Build System"
echo "====================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Project paths
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IOS_DIR="$PROJECT_ROOT/ios"

echo -e "${BLUE}📁 Project root: $PROJECT_ROOT${NC}"

# Step 1: Kill any existing Metro/Node processes
echo -e "\n${YELLOW}1️⃣ Cleaning up processes...${NC}"
killall -9 node 2>/dev/null || true
killall -9 watchman 2>/dev/null || true

# Step 2: Clear caches
echo -e "\n${YELLOW}2️⃣ Clearing caches...${NC}"
cd "$PROJECT_ROOT"
rm -rf node_modules/.cache
rm -rf $TMPDIR/react-*
rm -rf $TMPDIR/metro-*
rm -rf ~/Library/Developer/Xcode/DerivedData/D2DSalesTracker-*

# Step 3: Add new iOS files to Xcode project
echo -e "\n${YELLOW}3️⃣ Adding native files to Xcode project...${NC}"
node "$PROJECT_ROOT/scripts/add-ios-files.js"

# Step 4: Pod install
echo -e "\n${YELLOW}4️⃣ Installing CocoaPods dependencies...${NC}"
cd "$IOS_DIR"
pod install

# Step 5: Build and run
echo -e "\n${YELLOW}5️⃣ Building and running iOS app...${NC}"
cd "$PROJECT_ROOT"

# Check if simulator is running
if ! xcrun simctl list devices | grep -q "Booted"; then
    echo "Starting iOS Simulator..."
    open -a Simulator
    sleep 5
fi

# Run the app
npx react-native run-ios

echo -e "\n${GREEN}✅ Build complete!${NC}"
echo -e "${BLUE}📱 The app should now be running with native modules.${NC}"
echo -e "${BLUE}🔧 Check Settings > Use Native Map toggle${NC}"