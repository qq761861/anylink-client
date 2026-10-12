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
const { execFileSync, spawnSync } = require("child_process");

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

function resolve7zaCandidates() {
  // Return a list of 7za candidates, ordered by preference. The extraction
  // logic will try each one until success, so a broken binary can fall back.
  const candidates = [];
  try {
    const sevenZipBin = require("7zip-bin");
    if (sevenZipBin && sevenZipBin.path7za) {
      candidates.push(sevenZipBin.path7za);
    }
  } catch (e) {
    // 7zip-bin not available; fall back to PATH lookup below.
  }
  // System-installed 7z / 7za / 7zr via PATH.
  for (const c of ["7z", "7za", "7zr"]) {
    const r = spawnSync("where", [c], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) {
      const p = r.stdout.trim().split(/\r?\n/)[0];
      if (!candidates.includes(p)) candidates.push(p);
    }
  }
  // Common absolute install paths on Windows.
  for (const p of [
    "C:\\Program Files\\7-Zip\\7z.exe",
    "C:\\Program Files (x86)\\7-Zip\\7z.exe",
  ]) {
    if (fs.existsSync(p) && !candidates.includes(p)) candidates.push(p);
  }
  if (candidates.length === 0) {
    throw new Error("7-Zip not found; cannot extract NSIS installer");
  }
  return candidates;
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

function tryExtract(sevenZip, asset, tmp) {
  const result = spawnSync(sevenZip, ["x", "-y", `-o${tmp}`, asset], {
    encoding: "utf8",
  });
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  if (result.error) {
    return { ok: false, err: result.error.message, stdout, stderr };
  }
  if (result.status !== 0) {
    return { ok: false, err: `exit code ${result.status}`, stdout, stderr };
  }
  return { ok: true, stdout, stderr };
}

function extractWindowsNsis(asset, destDir, agentName, sevenZipCandidates) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-"));
  try {
    let extracted = false;
    const errors = [];
    for (const sevenZip of sevenZipCandidates) {
      log(`Extracting NSIS installer with ${sevenZip}`);
      const r = tryExtract(sevenZip, asset, tmp);
      if (r.ok) {
        extracted = true;
        break;
      }
      errors.push(`[${sevenZip}] ${r.err}`);
      log(`  failed: ${r.err}`);
      if (r.stdout) log(`  stdout: ${r.stdout.slice(0, 500)}`);
      if (r.stderr) log(`  stderr: ${r.stderr.slice(0, 500)}`);
      // 清理部分解压的结果，供下一个候选重试
      for (const e of fs.readdirSync(tmp)) {
        fs.rmSync(path.join(tmp, e), { recursive: true, force: true });
      }
    }
    if (!extracted) {
      throw new Error("all 7-Zip candidates failed:\n" + errors.join("\n"));
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
      const sevenZipCandidates = resolve7zaCandidates();
      extractWindowsNsis(assetPath, destDir, agentName, sevenZipCandidates);
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
