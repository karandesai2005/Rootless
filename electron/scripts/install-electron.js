#!/usr/bin/env node
const { downloadArtifact } = require("@electron/get");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const electronDir = path.join(__dirname, "..", "node_modules", "electron");
const { version } = require(path.join(electronDir, "package"));
const distDir = path.join(electronDir, "dist");
const platformPath =
  process.platform === "win32" ? "electron.exe" : "electron";

async function main() {
  const binaryPath = path.join(distDir, platformPath);
  if (fs.existsSync(binaryPath)) {
    return;
  }

  const zipPath = await downloadArtifact({
    version,
    artifactName: "electron",
    checksums: require(path.join(electronDir, "checksums.json")),
    platform: process.platform,
    arch: process.arch,
  });

  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  execFileSync("unzip", ["-qo", zipPath, "-d", distDir], { stdio: "inherit" });
  fs.writeFileSync(path.join(electronDir, "path.txt"), platformPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});