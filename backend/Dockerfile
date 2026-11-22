# Unino backend with score recognition (Audiveris) for Railway.
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
