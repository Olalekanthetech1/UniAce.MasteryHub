# Use the official Node.js 22 image for better compatibility
FROM node:22

# FFmpeg and FFprobe are required for verified server-side narration rendering.
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Verify package-lock.json existence and install dependencies
RUN if [ -f package-lock.json ]; then echo "package-lock.json found"; else echo "package-lock.json NOT found, generating..." && npm install --package-lock-only; fi
RUN npm install

# Copy the rest of your application's source code
COPY . .

# Build the React frontend into static files (dist/ folder)
RUN npm run build

# Verify build directory
RUN ls -la dist && test -f dist/index.html || (echo "Build failed: dist/index.html not found" && exit 1)

# Expose the port that the Express server will listen on
EXPOSE 3000

# Set environment variables for production
ENV NODE_ENV=production
ENV PORT=3000

# Start the Express backend
CMD ["npm", "start"]
