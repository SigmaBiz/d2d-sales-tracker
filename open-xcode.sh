#!/bin/bash

echo "Opening D2D Sales Tracker in Xcode..."
echo ""
echo "IMPORTANT: After Xcode opens:"
echo "1. Click on D2DSalesTracker in the file navigator"
echo "2. Right-click and choose 'Add Files to D2DSalesTracker'"
echo "3. Navigate to the ios/D2DSalesTracker folder"
echo "4. Select D2DNativeStorage.swift and D2DNativeStorage.m"
echo "5. Make sure 'Copy items if needed' is UNCHECKED (files are already there)"
echo "6. Make sure 'D2DSalesTracker' target is checked"
echo "7. Click Add"
echo "8. Build and run (Cmd+R)"
echo ""
echo "The native storage module will then be available in your app!"
echo ""
read -p "Press Enter to open Xcode..."

open ios/D2DSalesTracker.xcworkspace