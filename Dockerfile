FROM node:18-slim

WORKDIR /app

# Install curl for health checks
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY server.js ./
COPY lib/ ./lib/

# Copy frontend files (served by backend)
COPY index.html ./
COPY css/ ./css/
COPY js/ ./js/

# Expose the application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Run the application
CMD ["node", "server.js"]
