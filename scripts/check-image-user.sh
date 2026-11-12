#!/usr/bin/env bash
# Checks that the app in a Docker image runs as a normal user, not root, and can still read its files.
# Usage: scripts/check-image-user.sh <image>      (CI runs it; on the laptop: Git Bash)
# Exit 0 = OK, 1 = runs as root or cannot read its files.
set -euo pipefail
IMAGE="${1:?usage: $0 <image>}"

uid="$(docker run --rm "$IMAGE" id -u)"
user="$(docker run --rm "$IMAGE" whoami)"
echo "app user in $IMAGE: $user (uid $uid)"
if [ "$uid" = "0" ]; then
  echo "FAIL: the app runs as root. The Dockerfile needs 'USER node' before CMD."
  exit 1
fi

# the app must still be able to READ its code, packages and migrations, and must NOT be able to change them
docker run --rm "$IMAGE" node -e "
  const fs = require('fs');
  for (const f of ['server.js', 'migrate.js', 'migrations', 'node_modules/express/package.json']) fs.accessSync(f, fs.constants.R_OK);
  require('express'); require('pg'); require('socket.io');
  try { fs.appendFileSync('server.js', ''); console.error('FAIL: the app user can change server.js'); process.exit(1); }
  catch (e) { if (e.code !== 'EACCES') throw e; }
  console.log('reads its files: yes; can change server.js: no');
"
echo "OK"
