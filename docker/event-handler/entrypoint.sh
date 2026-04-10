#!/bin/sh
# Detect Docker socket GID and grant coding-agent access, then drop to coding-agent.

SOCKET=/var/run/docker.sock
if [ -S "$SOCKET" ]; then
  SOCK_GID=$(stat -c '%g' "$SOCKET")
  # Create or reuse a group with the socket's GID, add coding-agent to it
  if ! getent group "$SOCK_GID" > /dev/null 2>&1; then
    groupadd -g "$SOCK_GID" dockersock
  fi
  SOCK_GROUP=$(getent group "$SOCK_GID" | cut -d: -f1)
  usermod -aG "$SOCK_GROUP" coding-agent
fi


exec gosu coding-agent "$@"
