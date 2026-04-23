FROM node:20-slim

WORKDIR /app

# Copy manifests first — cache npm ci layer separately from source
COPY package.json package-lock.json ./

# Install all dependencies (tsx is a devDep, required at runtime)
RUN npm ci --silent

# Copy source after deps to preserve layer cache on source-only changes
COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

# Runtime data directory (mounted as volume in production)
RUN mkdir -p data

EXPOSE 3000

CMD ["npm", "run", "dashboard"]
