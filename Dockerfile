# Dockerfile for Google Cloud Run (Node.js 18 slim)
FROM node:18-slim

# App directory
WORKDIR /usr/src/app

# Install dependencies
COPY package*.json ./
RUN npm install --only=production

# Copy application files
COPY . .

# Expose port (Cloud Run defaults to 8080)
EXPOSE 8080

# Start server
CMD [ "node", "src/app.js" ]
