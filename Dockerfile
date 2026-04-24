FROM node:20-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

# Toolchain for building better-sqlite3; ca-certificates + curl for pulling
# the litestream release tarball. Toolchain is purged after npm install to
# keep the image small, ca-certificates stays for outbound HTTPS (gloss, R2).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Install litestream. Pinned to a known-good release; auto-detects arch so the
# same Dockerfile works on amd64 and arm64 hosts.
ARG LITESTREAM_VERSION=0.3.13
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) ls_arch=amd64 ;; \
      arm64) ls_arch=arm64 ;; \
      *) echo "unsupported arch $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-${ls_arch}.tar.gz" \
      | tar -xz -C /usr/local/bin litestream; \
    /usr/local/bin/litestream version

COPY package.json package-lock.json* ./
RUN npm install --omit=dev \
 && apt-get purge -y python3 make g++ curl \
 && apt-get autoremove -y
COPY server.js db.js gloss.js comms.js black.js readwise.js ai.js collab.js exports.js log.js litestream.yml ./
COPY routes ./routes
COPY migrations ./migrations
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data
EXPOSE 3748

# Wrap the node process in `litestream replicate -exec`. Litestream streams
# WAL frames to R2 in the background and forwards signals to the child. If R2
# creds aren't set, litestream logs warnings but still execs the app.
CMD ["litestream", "replicate", "-exec", "node server.js", "-config", "/app/litestream.yml"]
