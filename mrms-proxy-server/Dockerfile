# Real-Time MRMS Server with ecCodes
FROM node:18-slim

# Install system dependencies including ecCodes
RUN apt-get update && apt-get install -y \
    wget \
    gzip \
    libeccodes-tools \
    libeccodes-data \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node dependencies
RUN npm ci --only=production

# Copy server files
COPY server-realtime.js ./
COPY server-eccodes-final.js ./

# Create required directories
RUN mkdir -p realtime_cache realtime_temp

# Expose ports
EXPOSE 3003 3002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3003/health || exit 1

# Start the real-time server by default
CMD ["node", "server-realtime.js"]