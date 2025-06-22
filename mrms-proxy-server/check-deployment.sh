#!/bin/bash

echo "Monitoring deployment status..."
echo "Checking every 30 seconds for the optimized server..."
echo ""

while true; do
    RESPONSE=$(curl -s https://d2d-dynamic-server.onrender.com/health)
    SERVICE=$(echo $RESPONSE | grep -o '"service":"[^"]*"' | cut -d'"' -f4)
    
    if [ "$SERVICE" = "mrms-dynamic-server-precise" ]; then
        echo "✅ DEPLOYMENT COMPLETE!"
        echo "The optimized server is now live!"
        echo ""
        echo "Full response:"
        echo $RESPONSE | jq
        echo ""
        echo "Testing Sept 24, 2024 data..."
        curl -s "https://d2d-dynamic-server.onrender.com/api/mesh/2024-09-24" | jq '.summary'
        break
    else
        echo "$(date): Still deploying... Current service: $SERVICE"
        sleep 30
    fi
done