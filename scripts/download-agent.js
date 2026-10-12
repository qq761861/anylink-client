#!/usr/bin/env node
/**
 * Download and prepare the anylink_client_agent binary into the vpnagent/ directory.
 *
 * The anylink_client_agent binary is compiled independently and is not shipped
 * with the source repository. This script extracts the platform-specific agent
 * binary from the upstream anylink-client release package.
 *
 * Usage:
 *   node scripts/download-agent.js <platform> <arch>
 *
 *   platform: win | mac | linux
 *   arch:     amd64 | 386 | arm64 | arm
 *
 * Environment variables:
 *   AGENT_RELEASE_TAG   upstream release tag (default v1.0.1)
 *   AGENT_RELEASE_REPO  upstream repository (default jarryxy/anylink-client)
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const { execFileSync } = require("child_process");

const REPO = process.env.AGENT_RELEASE_REPO || "jarryxy/anylink-client";
const TAG = process.env.AGENT_RELEASE_TAG || "v1.0.1";

function log(msg) {
  process.stdout.write(msg + "\n");
}

function download(url, dest) {
  log(`Downloading: ${url}`);
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(
      url,
      { headers: { "User-Agent": "anylink-client-ci" } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(dest);
          resolve(download(res.headers.location, dest));
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      }
    );
    req.on("error", (err) => {
      file.close();
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

function resolve7za() {
  // Prefer the 7za binary bundled with electron-builder (7zip-bin), which is
  // guaranteed to exist after `yarn install` and behaves identically on CI
  // and locally. Fall back to a system-installed 7z/7za/7zr.
  const candidates = [];
  try {
    const sevenZipBin = require("7zip-bin");
    if (sevenZipBin && sevenZipBin.path7za) {
      candidates.push(sevenZipBin.path7za);
    }
  } catch (e) {
    // 7zip-bin not available; fall back to PATH lookup below.
  }
  candidates.push("7z", "7za", "7zr");

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  // Try PATH lookup for the bare command names.
  const { spawnSync } = require("child_process");
  for (const c of ["7z", "7za", "7zr"]) {
    const r = spawnSync("where", [c], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) {
      return r.stdout.trim().split(/\r?\n/)[0];
    }
  }
  throw new Error("7-Zip not found; cannot extract NSIS installer");
}

function findAgent(root) {
  const queue = [root];
  while (queue.length) {
    const dir = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        queue.push(full);
      } else if (e.isFile() && e.name.includes("anylink_client_agent")) {
        return full;
      }
    }
  }
  return null;
}

function extractWindowsNsis(asset, destDir, agentName, sevenZip) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-"));
  try {
    log(`Extracting NSIS installer with ${sevenZip}`);
    try {
      execFileSync(sevenZip, ["x", "-y", `-o${tmp}`, asset], {
        stdio: ["ignore", "ignore", "ignore"],
      });
    } catch (e) {
      throw new Error(`7-Zip extraction failed: ${e.message}`);
    }
    const agent = findAgent(tmp);
    if (!agent) {
      log("No agent found. Extracted .exe files:");
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) walk(full);
          else if (e.name.toLowerCase().endsWith(".exe")) {
            log(`  - ${path.relative(tmp, full)}`);
          }
        }
      };
      walk(tmp);
      throw new Error("anylink_client_agent not found in NSIS package");
    }
    fs.copyFileSync(agent, path.join(destDir, agentName));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function extractMacDmg(asset, destDir, agentName) {
  if (process.platform !== "darwin") {
    throw new Error("dmg extraction is only supported on macOS");
  }
  const mount = fs.mkdtempSync(path.join(os.tmpdir(), "dmg-"));
  try {
    execFileSync("hdiutil", ["attach", asset, "-mountpoint", mount, "-quiet"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    try {
      const agent = findAgent(mount);
      if (!agent) throw new Error("anylink_client_agent not found in dmg");
      fs.copyFileSync(agent, path.join(destDir, agentName));
    } finally {
      execFileSync("hdiutil", ["detach", mount, "-quiet"], {
        stdio: ["ignore", "ignore", "ignore"],
      });
    }
  } finally {
    fs.rmSync(mount, { recursive: true, force: true });
  }
}

function extractLinuxTar(asset, destDir, agentName) {
  // Use the system tar command to extract only the agent binary.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tar-"));
  try {
    execFileSync("tar", ["xzf", asset, "-C", tmp], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    const agent = findAgent(tmp);
    if (!agent) throw new Error("anylink_client_agent not found in tar.gz");
    fs.copyFileSync(agent, path.join(destDir, agentName));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const [platform, arch] = process.argv.slice(2);
  if (!platform || !arch) {
    log("Usage: node scripts/download-agent.js <win|mac|linux> <amd64|386|arm64|arm>");
    process.exit(1);
  }

  const agentNames = {
    win: `anylink_client_agent-windows-${arch}.exe`,
    mac: `anylink_client_agent-darwin-${arch}`,
    linux: `anylink_client_agent-linux-${arch}`,
  };
  if (!agentNames[platform]) {
    log(`Unknown platform: ${platform}`);
    process.exit(1);
  }
  const agentName = agentNames[platform];

  const ver = TAG.replace(/^v/, "");
  let assetName;
  if (platform === "win") {
    const assetArch = { amd64: "x64", 386: "ia32", arm64: "arm64" }[arch];
    assetName = `anylink-client-${ver}-win-${assetArch}.exe`;
  } else if (platform === "mac") {
    const assetArch = { amd64: "x64", arm64: "arm64" }[arch];
    assetName = `anylink-client-${ver}-mac-${assetArch}.dmg`;
  } else if (platform === "linux") {
    const assetArch = { amd64: "x64", arm: "armv7l", arm64: "arm64" }[arch];
    assetName = `anylink-client-${ver}-linux-${assetArch}.tar.gz`;
  } else {
    process.exit(1);
  }

  const url = `https://github.com/${REPO}/releases/download/${TAG}/${assetName}`;

  // __dirname is the scripts/ directory; its parent is the project root.
  const workdir = path.dirname(__dirname);
  const destDir = path.join(workdir, "vpnagent");
  fs.mkdirSync(destDir, { recursive: true });

  const assetPath = path.join(os.tmpdir(), `agent-${Date.now()}-${assetName}`);
  try {
    await download(url, assetPath);
    if (platform === "win") {
      const sevenZip = resolve7za();
      extractWindowsNsis(assetPath, destDir, agentName, sevenZip);
    } else if (platform === "mac") {
      extractMacDmg(assetPath, destDir, agentName);
    } else if (platform === "linux") {
      extractLinuxTar(assetPath, destDir, agentName);
    }

    const final = path.join(destDir, agentName);
    log(`Saved: ${final} (${fs.statSync(final).size} bytes)`);
  } finally {
    fs.rmSync(assetPath, { force: true });
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
