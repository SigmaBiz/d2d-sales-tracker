# Vercel Docker Container for GRIB2 Processing with eccodes
# This container provides the eccodes library needed to decode MRMS GRIB2 files

FROM node:20-bullseye-slim

# Install eccodes (GRIB2 decoder) and dependencies
RUN apt-get update && \
    apt-get install -y \
    libeccodes-tools \
    libeccodes-dev \
    gzip \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Verify eccodes is installed correctly
RUN grib_get_data --version || echo "Warning: grib_get_data not found"
RUN grib_ls --version || echo "Warning: grib_ls not found"

# Set working directory
WORKDIR /var/task

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy function code
COPY . .

# Expose port (not used in Vercel but good practice)
EXPOSE 3000

# The actual function entrypoint is handled by Vercel
# This CMD is for local testing
CMD ["node", "--version"]
