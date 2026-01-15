FROM node:18-alpine

# Install curl for health checks
RUN apk add --no-cache curl

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
# ⚠️ CRITICAL: All files below are REQUIRED for the app to work!
# If you add new modules or files, you MUST add them here.
# Missing files = container crash or broken UI
COPY server.js ./
COPY index.html ./
COPY styles.css ./
COPY app.js ./
COPY factory-command-center.html ./
# ⚠️ lib/ folder contains all backend modules - DO NOT FORGET THIS
COPY lib/ ./lib/

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Expose ports
EXPOSE 3000 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start server
CMD ["node", "server.js"]
