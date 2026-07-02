#!/bin/bash
set -e

echo "Downloading John the Ripper 1.9.0-jumbo-1..."
wget -qO john.tar.gz https://github.com/openwall/john/archive/refs/tags/1.9.0-jumbo-1.tar.gz

echo "Extracting..."
tar -xzf john.tar.gz
cd john-1.9.0-jumbo-1/src

echo "Building..."
./configure
make -s clean
make -sj4

cd ../run
echo "Build complete."

mkdir -p ../../staging
cp john ../../staging/john-linux-x86_64
cd ../..

echo "SHA256 for TOOL_REGISTRY:"
sha256sum staging/john-linux-x86_64

echo "Done! The binary is at staging/john-linux-x86_64"
