#!/bin/bash
# Start Expo in one terminal
npx expo start &
EXPO_PID=$!

# Wait for Metro to start
sleep 5

# Get the Metro port (usually 8081)
METRO_PORT=8081

# Start ngrok tunnel
echo "Starting ngrok tunnel for port $METRO_PORT..."
npx @expo/ngrok http $METRO_PORT

# Kill Expo when done
kill $EXPO_PID