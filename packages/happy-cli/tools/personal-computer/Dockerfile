FROM node:24-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
 && apt-get -o Acquire::Retries=3 update \
 && apt-get -o Acquire::Retries=3 install -y --no-install-recommends ca-certificates \
 && sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
 && apt-get -o Acquire::Retries=3 update \
 && apt-get -o Acquire::Retries=3 install -y --no-install-recommends chromium xvfb socat tini fonts-noto-cjk python3 curl \
 && rm -rf /var/lib/apt/lists/*
ARG TARGETARCH
RUN case "$TARGETARCH" in arm64) asset=arm64; digest=faccaa543990afff07fb0a769fb2e8f5d17688dd95f6f71857780228e905f1ba;; amd64) asset=x64; digest=d6976d5931b620fa82bccf8a8743668f4066f5927567f6a7e87c770534db43ec;; *) exit 1;; esac \
 && curl --fail --location --max-time 180 "https://github.com/leeguooooo/chrome-use/releases/download/v1.5.291/chrome-use-linux-${asset}.tar.gz" -o /tmp/chrome-use.tar.gz \
 && echo "$digest  /tmp/chrome-use.tar.gz" | sha256sum -c - \
 && mkdir /tmp/chrome-use-dist && tar -xzf /tmp/chrome-use.tar.gz -C /tmp/chrome-use-dist \
 && install -m 0555 /tmp/chrome-use-dist/chrome-use /usr/local/bin/chrome-use \
 && mkdir -p /usr/share/doc/chrome-use && cp /tmp/chrome-use-dist/LICENSE* /usr/share/doc/chrome-use/ \
 && rm -rf /tmp/chrome-use.tar.gz /tmp/chrome-use-dist
COPY egress.mjs /opt/paws/egress.mjs
COPY start.sh /opt/paws/start.sh
COPY workspace.mjs /opt/paws/workspace.mjs
COPY kill-chrome-use.mjs /opt/paws/kill-chrome-use.mjs
COPY command.mjs /opt/paws/command.mjs
ENV CHROME_USE_NO_UPDATE_CHECK=1 USE_NO_UPDATE_CHECK=1 AGENT_BROWSER_NO_AUTO_RECONNECT=1 AGENT_BROWSER_IDLE_TIMEOUT_MS=0 AGENT_BROWSER_GROUP_CLEANUP_MS=0
RUN chmod 0555 /opt/paws/start.sh && mkdir /workspace /profile && chown node:node /workspace /profile
USER node
WORKDIR /workspace
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/opt/paws/start.sh"]
