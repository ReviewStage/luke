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

# Docker's engine, its Compose and Buildx plugins, so a repository whose dev server or tests run in
# containers runs them here as on a laptop. Its daemon is started by the `docker` below on first use
# rather than at every launch, since no process outlives a sandbox's stop and most repositories never
# ask for it. The default user, every Terminal shell's, joins the `docker` group here; the `agent`
# user, made as a sandbox opens, joins it at each launch (`vercel-machine.ts`'s `readyScript`).
RUN apt-get update \
 && apt-get install -y --no-install-recommends docker.io docker-compose-v2 docker-buildx \
 && usermod -aG docker ubuntu \
 && rm -rf /var/lib/apt/lists/*

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
# repository's own credential on GitHub's hosts in its place (`sandbox-firewall.ts`). Its `stack`
# runs GitHub's own `gh stack` extension below for every user, the `agent` user the SDK makes at
# launch among them, where an extension `gh` installs is one user's alone. Note that the
# placeholder is written in two parts, because the repository check refuses a literal shaped as a
# GitHub token.
COPY --chmod=0755 <<'EOF' /usr/local/bin/gh
#!/usr/bin/env bash
export GH_TOKEN="${GH_TOKEN:-"ghp_"000000000000000000000000000000000000}"
if [ "${1:-}" = stack ]; then shift; exec /usr/local/lib/gh-stack/gh-stack "$@"; fi
exec /usr/bin/gh "$@"
EOF

# `docker` with its daemon started first where none runs, detached as root in a session of its own so
# it outlives the command that asked, and waited on until it answers; the CLI's plugins, `compose`
# among them, all run through it.
COPY --chmod=0755 <<'EOF' /usr/local/bin/docker
#!/usr/bin/env bash
if ! pgrep -x dockerd > /dev/null; then
  sudo -n sh -c 'setsid -f dockerd >> /var/log/dockerd.log 2>&1 < /dev/null'
  if ! timeout 30 sh -c 'until /usr/bin/docker info > /dev/null 2>&1; do sleep 0.2; done'; then
    echo "docker: the daemon did not start; its log is /var/log/dockerd.log" >&2
    exit 1
  fi
fi
exec /usr/bin/docker "$@"
EOF

# The `agent` user each harness runs as may run anything as root, as the default user every
# Terminal shell runs as already may, so an agent installs what a repository's setup needs that
# the image lacks, a system package or a service, as its README says to. Nothing it guards is kept
# from root: the tokens an agent uses stand at the sandbox's firewall, outside it
# (`sandbox-firewall.ts`). The rule names a user the image does not yet hold, which sudo matches
# once the sandbox makes it; the last line fails the image where sudo would refuse the file.
COPY --chmod=0440 <<'EOF' /etc/sudoers.d/agent
agent ALL=(ALL:ALL) NOPASSWD: ALL
EOF
RUN visudo -cf /etc/sudoers.d/agent

# GitHub's own `gh stack` extension, its release's Linux binary checked against the digest GitHub
# publishes, which the wrapper above runs; the last line fails the image where an unprivileged user
# cannot run it.
ADD --chmod=0755 --checksum=sha256:ffe9d48b6342faffc3b0cb420202ff1df32e24faf32693debd7423274bbdf859 \
    https://github.com/github/gh-stack/releases/download/${GH_STACK_VERSION}/linux-amd64 \
    /usr/local/lib/gh-stack/gh-stack
RUN runuser -u nobody -- env HOME=/tmp GH_STACK_NO_UPDATE_NOTIFIER=1 gh stack --help > /dev/null

# The runner each launch starts, and the agent's pointer as a recorded video draws it, which an
# agent's own Playwright script adds to the pages it records. Note that their folders are made
# first, because a `COPY --chmod` gives the folders it makes the file's own mode, which no user
# could pass through; the last line fails the image where one still cannot read them.
RUN install -d -m 0755 /opt/agent/agent-runner /usr/local/share/agent-recording
COPY --chmod=0444 agent-runner.mjs /opt/agent/agent-runner/agent-runner.mjs
COPY --chmod=0644 cursor.js /usr/local/share/agent-recording/cursor.js
RUN runuser -u nobody -- cat /opt/agent/agent-runner/agent-runner.mjs /usr/local/share/agent-recording/cursor.js > /dev/null

# Where an agent's checkout is cloned, the default user's, who clones it.
RUN install -d -o ubuntu -g ubuntu /workspace

USER ubuntu
ENV HOME=/vercel
WORKDIR /vercel
