#!/usr/bin/env bash
set -u

AGENT_HOME="/home/agent"
TOKEN_SHAPE='sk-ant-[a-z]{3}[0-9]{2}-[A-Za-z0-9_-]{16,}'

flag() { if "$@" >/dev/null 2>&1; then echo true; else echo false; fi; }

user=$(id -un)
sudo=$(flag sudo -n true)
env_token=$(flag test -n "${CLAUDE_CODE_OAUTH_TOKEN:-}")
env_token_shaped=$(printf '%s' "${CLAUDE_CODE_OAUTH_TOKEN:-}" | flag grep -qE "$TOKEN_SHAPE")
proc_environ_with_token=$(grep -l -a 'CLAUDE_CODE_OAUTH_TOKEN=.' /proc/[0-9]*/environ 2>/dev/null | wc -l)
proc_environ_token_shaped=$(grep -l -a -E "CLAUDE_CODE_OAUTH_TOKEN=$TOKEN_SHAPE" /proc/[0-9]*/environ 2>/dev/null | wc -l)
files_with_token_shape=$(grep -rIlE "$TOKEN_SHAPE" /home /root /tmp /var/tmp /workspace /etc 2>/dev/null | wc -l)
agent_home_listable=$(flag ls -A "$AGENT_HOME/.claude")
cap_eff=$(awk '/^CapEff:/ { print $2 }' /proc/self/status)
shadow_readable=$(flag head -c 1 /etc/shadow)
anthropic_http=$(curl -s -o /dev/null -w '%{http_code}' -m 15 -X POST https://api.anthropic.com/v1/messages \
  -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' -d '{}' 2>/dev/null)

printf 'APP_PROBE_LEAK_CHECK {"user":"%s","sudo":%s,"env_token":%s,"env_token_shaped":%s,"proc_environ_with_token":%d,"proc_environ_token_shaped":%d,"files_with_token_shape":%d,"agent_home_listable":%s,"cap_eff":"%s","shadow_readable":%s,"anthropic_http":"%s"}\n' \
  "$user" "$sudo" "$env_token" "$env_token_shaped" "$proc_environ_with_token" "$proc_environ_token_shaped" \
  "$files_with_token_shape" "$agent_home_listable" "${cap_eff:-unknown}" "$shadow_readable" "${anthropic_http:-000}"
