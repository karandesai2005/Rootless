# Releasing Tool Binaries

Some tools (like John the Ripper) don't have official static/portable binary releases for Linux. We host them as GitHub Release assets in the Rootless repository.

## 1. Build John the Ripper

Run the fetch script to download, compile, and stage the binary:
```bash
chmod +x scripts/fetch-john-binary.sh
./scripts/fetch-john-binary.sh
```
This will place the binary at `staging/john-linux-x86_64` and print its SHA256 checksum.

## 2. Create a GitHub Release

1. Go to https://github.com/karandesai2005/Rootless/releases
2. Click **Draft a new release**
3. Set the tag to `tools-v1`
4. Title it `Tool Binaries v1`
5. Upload the `staging/john-linux-x86_64` file as a release asset.
6. Publish the release.

## 3. Update toolmanager.go

Copy the SHA256 checksum printed by the build script, and paste it into the `TOOL_REGISTRY` in `sandbox-go/toolmanager/toolmanager.go` under the `john` entry (replace `FILL_IN`).
