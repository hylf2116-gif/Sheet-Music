# Unino backend with score recognition for Railway: homr (AI, used first) + Audiveris (fallback).
# Railway builds this automatically when the service's root directory is `backend`.
# If the build fails, Railway keeps the previous version running.

FROM node:22-bookworm-slim

# Audiveris (official Linux release; it brings its own Java runtime) + unzip (used to read its files)
ARG AUDIVERIS_VERSION=5.11.0
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip fontconfig \
 && curl -fsSL -o /tmp/audiveris.deb \
      "https://github.com/Audiveris/audiveris/releases/download/${AUDIVERIS_VERSION}/Audiveris-${AUDIVERIS_VERSION}-ubuntu22.04-x86_64.deb" \
 && apt-get install -y --no-install-recommends /tmp/audiveris.deb \
 && rm -f /tmp/audiveris.deb \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# homr: AI music recognition in its own Python environment. `homr --init` downloads its models
# during the build, so the first score doesn't wait for them.
ARG HOMR_VERSION=0.7.1
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv libglib2.0-0 \
 && python3 -m venv /opt/homr \
 && /opt/homr/bin/pip install --no-cache-dir "homr[cpu]==${HOMR_VERSION}" pypdfium2 \
 && /opt/homr/bin/homr --init \
 && rm -rf /var/lib/apt/lists/*
ENV HOMR_PYTHON=/opt/homr/bin/python

# Where the server finds Audiveris; run Java without a screen, with a memory cap that fits a
# small server (raise it on Railway with JAVA_TOOL_OPTIONS if large scores fail).
ENV AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris \
    JAVA_TOOL_OPTIONS="-Djava.awt.headless=true -Xmx1500m" \
    NODE_ENV=production

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

CMD ["node", "index.js"]
