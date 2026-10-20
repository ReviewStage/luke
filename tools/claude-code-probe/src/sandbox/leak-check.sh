#!/usr/bin/env bash
# leak-check.sh -- what the user running it can see of Claude Code's token, printed as counts and flags after one marker, never a value it read.
#
# Run from a Terminal's shell (the sandbox's default user, no sudo) as it is
# today and with its capabilities dropped, as the agent user outside Claude
# Code's command sandbox, and by the agent through its Bash tool (inside
# that sandbox). The effective capabilities and /etc/shadow are reported
# because the default user holds the full capability set without sudo. Every probe is allowed to fail; a failure is what a
# private token looks like.
set -u

AGENT_HOME="/home/agent"
# The shape of an Anthropic key or OAuth token; a shape, not a value.
TOKEN_SHAPE='sk-ant-[a-z]{3}[0-9]{2}-[A-Za-z0-9_-]{16,}'

flag() { if "$@" >/dev/null 2>&1; then echo true; else echo false; fi; }

user=$(id -un)
sudo=$(flag sudo -n true)
env_token=$(flag test -n "${CLAUDE_CODE_OAUTH_TOKEN:-}")
proc_environ_with_token=$(grep -l -a 'CLAUDE_CODE_OAUTH_TOKEN=.' /proc/[0-9]*/environ 2>/dev/null | wc -l)
files_with_token_shape=$(grep -rIlE "$TOKEN_SHAPE" /home /root /tmp /var/tmp /workspace /etc 2>/dev/null | wc -l)
agent_home_listable=$(flag ls -A "$AGENT_HOME/.claude")
cap_eff=$(awk '/^CapEff:/ { print $2 }' /proc/self/status)
shadow_readable=$(flag head -c 1 /etc/shadow)
anthropic_http=$(curl -s -o /dev/null -w '%{http_code}' -m 15 -X POST https://api.anthropic.com/v1/messages \
  -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' -d '{}' 2>/dev/null)

printf 'LUKE_PROBE_LEAK_CHECK {"user":"%s","sudo":%s,"env_token":%s,"proc_environ_with_token":%d,"files_with_token_shape":%d,"agent_home_listable":%s,"cap_eff":"%s","shadow_readable":%s,"anthropic_http":"%s"}\n' \
  "$user" "$sudo" "$env_token" "$proc_environ_with_token" "$files_with_token_shape" "$agent_home_listable" \
  "${cap_eff:-unknown}" "$shadow_readable" "${anthropic_http:-000}"
