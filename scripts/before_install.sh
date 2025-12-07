#!/usr/bin/env bash
set -e

BACKEND_ROOT="/home/ubuntu/project/caquick-backend"

echo "[BeforeInstall] prepare directories"

mkdir -p /tmp/caquick-backend
mkdir -p "$BACKEND_ROOT/blue"
mkdir -p "$BACKEND_ROOT/green"
