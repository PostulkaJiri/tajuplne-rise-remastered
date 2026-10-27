#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

docker compose config --quiet
docker compose build tajuplne-rise

# These checks must succeed immediately before creation/start; no cleanup or
# alternative port is permitted if any conflicting resource already exists.
addresses="$(ip -4 -o address show)"
if ! printf '%s\n' "$addresses" | awk '$4 ~ /^192\.168\.0\.249\// {found=1} END {exit !found}'; then
  echo 'LAN address 192.168.0.249 is not assigned; deployment stopped.' >&2
  exit 1
fi
existing="$(docker ps -a --filter 'name=^/tajuplne-rise-remastered-ocr$' --format '{{.ID}} {{.Names}}')"
if [[ -n "$existing" ]]; then
  echo "Container name already exists; deployment stopped: $existing" >&2
  exit 1
fi
for resource in network volume; do
  if [[ "$resource" == network ]]; then
    names="$(docker network ls --format '{{.Name}}')"
    target='tajuplne-rise-remastered-internal'
  else
    names="$(docker volume ls --format '{{.Name}}')"
    target='tajuplne-rise-remastered-paddle-cache'
  fi
  if printf '%s\n' "$names" | grep -Fxq "$target"; then
    echo "$resource $target already exists; verify ownership before deployment." >&2
    exit 1
  fi
done
containers="$(docker ps --format 'table {{.Names}}\t{{.Ports}}')"
printf '%s\n' "$containers"
listeners="$(ss -ltnp)"
if printf '%s\n' "$containers" | grep -Eq '(^|[[:space:]:])18080->'; then
  echo 'TCP port 18080 is published by Docker; deployment stopped.' >&2
  exit 1
fi
if printf '%s\n' "$listeners" | grep -E ':18080([[:space:]]|$)'; then
  echo 'TCP port 18080 is in use on the host; deployment stopped.' >&2
  exit 1
fi

docker compose up -d --no-build --no-deps tajuplne-rise
