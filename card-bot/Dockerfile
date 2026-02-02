FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Use production mode by default inside the image
ENV NODE_ENV=production

# Install build dependencies necessary for native modules (better-sqlite3)
# and keep sqlite runtime libs available. We install build deps only for
# the `npm ci` step and remove them afterward to keep the image small.
RUN apk add --no-cache --virtual .build-deps build-base python3 make sqlite-dev \
	&& apk add --no-cache sqlite-libs

# Copy package manifests first for better layer caching
COPY package.json package-lock.json* ./

# Install production dependencies (will compile native modules using build deps)
RUN npm ci --only=production || npm install --production

# Remove build-time packages (leave sqlite-libs which is needed at runtime)
RUN apk del .build-deps || true

# Copy app source
COPY . .

# It's expected that secrets (like .env) are provided via runtime env or
# docker `--env-file` and not baked into the image.

CMD ["node", "index.js"]
