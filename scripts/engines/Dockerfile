# Runtime for the engine smoke suite (scripts/engines): Node.js to serve the
# fixtures and drive CDP, an X server, and the libraries archived Chromium
# builds link against. Ubuntu 20.04 still ships the oldest of them
# (libgconf-2-4 and GTK 2 for Chromium 53). The build itself is mounted at
# /chrome and the repository at /repo.
FROM node:22-bullseye-slim AS node

# Pango 1.44+ refuses to start Chromium 53, whose built-in HarfBuzz it finds
# too old; Ubuntu 18.04's Pango 1.40 does not check. run-engine.mjs puts it
# on LD_LIBRARY_PATH for the engines that need it.
FROM ubuntu:18.04 AS pango
RUN apt-get update && apt-get install -y --no-install-recommends libpango1.0-0 \
  && mkdir /pango && cp -a /usr/lib/x86_64-linux-gnu/libpango*-1.0.so.0* /pango/

FROM ubuntu:20.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates xvfb xauth fonts-dejavu-core fonts-noto-core fonts-noto-cjk \
    libgconf-2-4 libgtk2.0-0 libgtk-3-0 libnss3 libxss1 libasound2 libgbm1 libxshmfence1 \
    libx11-xcb1 libxtst6 libdrm2 libatk-bridge2.0-0 libcups2 libxkbcommon0 libpango-1.0-0 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=pango /pango /opt/legacy-pango
COPY entrypoint.sh /usr/local/bin/engine-entrypoint
ENTRYPOINT ["/usr/local/bin/engine-entrypoint"]
