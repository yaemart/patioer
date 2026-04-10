FROM node:22-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/dataos-api/package.json ./apps/dataos-api/
COPY packages ./packages/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Expose port
EXPOSE 3100

# Start the application with tsx for runtime TypeScript compilation
CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]
