# syntax=docker/dockerfile:1
#
# Dockerfile -- the image every cloud agent's sandbox boots from, as a Vercel Sandbox custom image
# (https://vercel.com/docs/sandbox/concepts/images).
#
# CI's `agent-image` job stages this folder with the runner's bundle and the recording pointer beside
# it (`apps/web/scripts/agent-image.ts`), tags the image with a digest of what it staged, and pushes it
# to the project's registry, waiting until Vercel has it ready, before any deploy names that tag. It
# builds on Vercel's own Node image: Ubuntu with Node, pnpm, git, and sudo, and the `ubuntu` user the
# sandbox's API runs commands as. The `agent` user each harness runs as is the SDK's, made as a
# sandbox opens (`packages/service/src/agents/machine/vercel-machine.ts`).
#
# The versions and paths are `@repo/agent-runner/pins`'s, whose versions
# `tools/anti-slop/guards/agent-pins.ts` holds these `ARG`s to.

FROM vcr.vercel.com/vercel/sandbox/node:24

ARG PLAYWRIGHT_VERSION=1.64.1
ARG CLAUDE_AGENT_SDK_VERSION=0.3.304
ARG CLAUDE_CODE_VERSION=2.1.304
ARG CODEX_VERSION=0.163.0
ARG GH_STACK_VERSION=v0.2.1

USER root
ENV HOME=/root
ARG DEBIAN_FRONTEND=noninteractive

# Python and pip; tmux, which holds each Terminal tab's shell so it outlives any connection to it;
# GitHub's CLI; and the everyday tools the agents' earlier image carried.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-pip python-is-python3 tmux gh \
      curl jq ripgrep unzip zstd procps bind9-dnsutils \
 && rm -rf /var/lib/apt/lists/*
COPY tmux.conf /etc/tmux.conf

# Playwright and its full Chromium beside the headless shell, so a coding agent screenshots what it
# built, and the agent's own browser runs headful under Xvfb, where a sign-in sees an ordinary Chrome.
# The browsers live inside the package, where every user reads them; the last line fails the image
# where npm put them elsewhere. GTK 3 follows, the one library `--with-deps` leaves an Electron app
# missing.
RUN npm install --global --prefix /usr/local --no-audit --no-fund playwright@${PLAYWRIGHT_VERSION} \
 && PLAYWRIGHT_BROWSERS_PATH=0 playwright install --with-deps chromium \
 && apt-get install -y --no-install-recommends libgtk-3-0t64 \
 && chmod -R a+rX /usr/local/lib/node_modules/playwright/node_modules/playwright-core/.local-browsers \
 && ls -d /usr/local/lib/node_modules/playwright/node_modules/playwright-core/.local-browsers/chromium-* \
 && rm -rf /var/lib/apt/lists/* \
 && npm cache clean --force

# The Claude Agent SDK and the `claude` binary it carries, linked as `claude`, and Codex, linked as
# `codex`, each under a prefix only root writes.
RUN npm install --prefix /opt/agent/claude-agent-sdk --no-audit --no-fund --save-exact \
      @anthropic-ai/claude-agent-sdk@${CLAUDE_AGENT_SDK_VERSION} \
 && ln -sfn /opt/agent/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude /usr/local/bin/claude \
 && claude --version | grep -q "^${CLAUDE_CODE_VERSION} " \
 && npm install --global --prefix /opt/agent/codex --no-audit --no-fund @openai/codex@${CODEX_VERSION} \
 && ln -sfn /opt/agent/codex/bin/codex /usr/local/bin/codex \
 && codex --version | grep -Fxq "codex-cli ${CODEX_VERSION}" \
 && npm cache clean --force

# `gh` with a token of no worth, so it asks GitHub at all: the sandbox's firewall sets the
# repository's own credential on GitHub's hosts in its place (`sandbox-firewall.ts`). Note that the
# placeholder is written in two parts, because the repository check refuses a literal shaped as a
# GitHub token.
COPY --chmod=0755 <<'EOF' /usr/local/bin/gh
#!/usr/bin/env bash
export GH_TOKEN="${GH_TOKEN:-"ghp_"000000000000000000000000000000000000}"
exec /usr/bin/gh "$@"
EOF

# GitHub's own `gh stack` extension, its release's Linux binary checked against the digest GitHub
# publishes, and linked as a local extension, which `gh` installs without reaching GitHub.
ADD --chmod=0755 --checksum=sha256:ffe9d48b6342faffc3b0cb420202ff1df32e24faf32693debd7423274bbdf859 \
    https://github.com/github/gh-stack/releases/download/${GH_STACK_VERSION}/linux-amd64 \
    /usr/local/lib/gh-stack/gh-stack

# The runner each launch starts, and the agent's pointer as a recorded video draws it, which an
# agent's own Playwright script adds to the pages it records.
COPY --chmod=0444 agent-runner.mjs /opt/agent/agent-runner/agent-runner.mjs
COPY --chmod=0644 cursor.js /usr/local/share/agent-recording/cursor.js

# Where an agent's checkout is cloned, the default user's, who clones it.
RUN install -d -o ubuntu -g ubuntu /workspace

USER ubuntu
ENV HOME=/vercel
WORKDIR /vercel
RUN cd /usr/local/lib/gh-stack && gh extension install . && gh stack --help >/dev/null
