#!/usr/bin/env bash
# Run this on the SERVER while a load test (or the real event) is running.
# Prints one line every few seconds: CPU, memory, swap, open connections, memory of each container.
#   ./scripts/watch-load.sh          one line every 5 seconds
#   ./scripts/watch-load.sh 2        one line every 2 seconds
# Stop with Ctrl+C. If a line starts with "!!", stop the load test.
cd "$(dirname "$0")/.." || exit 1
INTERVAL="${1:-5}"

cpu_snapshot() { awk '/^cpu /{print $2+$3+$4+$6+$7+$8, $2+$3+$4+$5+$6+$7+$8}' /proc/stat; }
read -r BUSY0 TOTAL0 < <(cpu_snapshot)

while true; do
  sleep "$INTERVAL"
  read -r BUSY1 TOTAL1 < <(cpu_snapshot)
  DT=$((TOTAL1 - TOTAL0))
  CPU=0
  [ "$DT" -gt 0 ] && CPU=$(( (BUSY1 - BUSY0) * 100 / DT ))
  BUSY0=$BUSY1; TOTAL0=$TOTAL1

  read -r USED AVAIL < <(free -m | awk 'NR==2{print $3, $7}')
  SWAP="$(free -m | awk '/^Swap:/{print $3}')"
  CONNS="$(ss -Htn state established '( sport = :443 or sport = :80 )' 2>/dev/null | wc -l)"

  CONT=""
  if command -v docker >/dev/null 2>&1; then
    CONT="$(docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' 2>/dev/null | awk '{ if (match($1, /-(app|caddy|db|redis)-[0-9]+$/)) { n = substr($1, RSTART + 1, RLENGTH - 1); sub(/-[0-9]+$/, "", n); split($2, m, "/"); printf "%s %s  ", n, m[1] } }')"
  fi

  FLAG=""
  [ "${AVAIL:-9999}" -lt 150 ] && FLAG="  !! LOW MEMORY"
  [ "${SWAP:-0}" -gt 300 ] && FLAG="$FLAG  !! USING SWAP"
  [ "$CPU" -ge 95 ] && FLAG="$FLAG  !! CPU FULL"
  echo "$(date +%H:%M:%S)  cpu ${CPU}% | memory used ${USED} MB, available ${AVAIL} MB | swap ${SWAP} MB | connections ${CONNS} | ${CONT}${FLAG}"
done
