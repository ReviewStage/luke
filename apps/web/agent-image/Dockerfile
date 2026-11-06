# syntax=docker/dockerfile:1

FROM vcr.vercel.com/vercel/sandbox/node:24

ARG PLAYWRIGHT_VERSION=1.64.1
ARG CLAUDE_AGENT_SDK_VERSION=0.3.304
ARG CLAUDE_CODE_VERSION=2.1.304
ARG CODEX_VERSION=0.163.0
ARG GH_STACK_VERSION=v0.2.1

USER root
ENV HOME=/root
ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-pip python-is-python3 tmux gh \
      curl jq ripgrep unzip zstd procps bind9-dnsutils \
 && rm -rf /var/lib/apt/lists/*
COPY tmux.conf /etc/tmux.conf

RUN npm install --global --prefix /usr/local --no-audit --no-fund playwright@${PLAYWRIGHT_VERSION} \
 && PLAYWRIGHT_BROWSERS_PATH=0 playwright install --with-deps chromium \
 && apt-get install -y --no-install-recommends libgtk-3-0t64 \
 && chmod -R a+rX /usr/local/lib/node_modules/playwright/node_modules/playwright-core/.local-browsers \
 && ls -d /usr/local/lib/node_modules/playwright/node_modules/playwright-core/.local-browsers/chromium-* \
 && rm -rf /var/lib/apt/lists/* \
 && npm cache clean --force

RUN npm install --prefix /opt/agent/claude-agent-sdk --no-audit --no-fund --save-exact \
      @anthropic-ai/claude-agent-sdk@${CLAUDE_AGENT_SDK_VERSION} \
 && ln -sfn /opt/agent/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude /usr/local/bin/claude \
 && claude --version | grep -q "^${CLAUDE_CODE_VERSION} " \
 && npm install --global --prefix /opt/agent/codex --no-audit --no-fund @openai/codex@${CODEX_VERSION} \
 && ln -sfn /opt/agent/codex/bin/codex /usr/local/bin/codex \
 && codex --version | grep -Fxq "codex-cli ${CODEX_VERSION}" \
 && npm cache clean --force

COPY --chmod=0755 <<'EOF' /usr/local/bin/gh
#!/usr/bin/env bash
export GH_TOKEN="${GH_TOKEN:-"ghp_"000000000000000000000000000000000000}"
if [ "${1:-}" = stack ]; then shift; exec /usr/local/lib/gh-stack/gh-stack "$@"; fi
exec /usr/bin/gh "$@"
EOF

ADD --chmod=0755 --checksum=sha256:ffe9d48b6342faffc3b0cb420202ff1df32e24faf32693debd7423274bbdf859 \
    https://github.com/github/gh-stack/releases/download/${GH_STACK_VERSION}/linux-amd64 \
    /usr/local/lib/gh-stack/gh-stack
RUN runuser -u nobody -- env HOME=/tmp GH_STACK_NO_UPDATE_NOTIFIER=1 gh stack --help > /dev/null

RUN install -d -m 0755 /opt/agent/agent-runner /usr/local/share/agent-recording
COPY --chmod=0444 agent-runner.mjs /opt/agent/agent-runner/agent-runner.mjs
COPY --chmod=0644 cursor.js /usr/local/share/agent-recording/cursor.js
RUN runuser -u nobody -- cat /opt/agent/agent-runner/agent-runner.mjs /usr/local/share/agent-recording/cursor.js > /dev/null

RUN install -d -o ubuntu -g ubuntu /workspace

USER ubuntu
ENV HOME=/vercel
WORKDIR /vercel
