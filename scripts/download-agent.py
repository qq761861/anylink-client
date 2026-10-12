#!/usr/bin/env python3
"""
Download and prepare the anylink_client_agent binary into the vpnagent/ directory.

The anylink_client_agent binary is compiled independently and is not shipped
with the source repository. This script extracts the platform-specific agent
binary from the upstream anylink-client release package.

Usage:
  python scripts/download-agent.py <platform> <arch>

  platform: win | mac | linux
  arch:     amd64 | 386 | arm64 | arm

Environment variables:
  AGENT_RELEASE_TAG   upstream release tag (default v1.0.1)
  AGENT_RELEASE_REPO  upstream repository (default jarryxy/anylink-client)
"""
import os
import sys
import stat
import shutil
import tarfile
import tempfile
import subprocess
import urllib.request

REPO = os.environ.get("AGENT_RELEASE_REPO", "jarryxy/anylink-client")
TAG = os.environ.get("AGENT_RELEASE_TAG", "v1.0.1")


def log(msg):
    print(msg, flush=True)


def download(url, dest):
    log(f"Downloading: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "anylink-client-ci"})
    with urllib.request.urlopen(req) as resp, open(dest, "wb") as f:
        shutil.copyfileobj(resp, f)


def find_agent(root):
    """Recursively locate the anylink_client_agent binary."""
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            if "anylink_client_agent" in name:
                return os.path.join(dirpath, name)
    return None


def extract_windows_nsis(asset, dest_dir, agent_name):
    """Extract the agent from a Windows NSIS installer using 7-Zip."""
    candidates = [
        "7z",
        "7za",
        "7zr",
        r"C:\Program Files\7-Zip\7z.exe",
        r"C:\Program Files (x86)\7-Zip\7z.exe",
    ]
    seven_zip = None
    for c in candidates:
        p = shutil.which(c)
        if p:
            seven_zip = p
            break
    if not seven_zip:
        raise RuntimeError("7-Zip not found; cannot extract NSIS installer")

    with tempfile.TemporaryDirectory() as tmp:
        log(f"Extracting NSIS installer with {seven_zip}")
        # Extract the whole package first, then locate the agent binary recursively.
        # Keep 7-Zip output for diagnostics.
        result = subprocess.run(
            [seven_zip, "x", "-y", f"-o{tmp}", asset],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
        if result.stdout:
            log(result.stdout.decode("utf-8", "replace"))
        if result.returncode != 0:
            raise RuntimeError(f"7-Zip extraction failed with code {result.returncode}")
        agent = find_agent(tmp)
        if not agent:
            # Diagnostic: list extracted .exe files to help troubleshooting.
            log("No agent found. Extracted .exe files:")
            for dirpath, _dirs, files in os.walk(tmp):
                for name in files:
                    if name.lower().endswith(".exe"):
                        log(f"  - {os.path.relpath(os.path.join(dirpath, name), tmp)}")
            raise RuntimeError("anylink_client_agent not found in NSIS package")
        shutil.copy(agent, os.path.join(dest_dir, agent_name))


def extract_mac_dmg(asset, dest_dir, agent_name):
    """Mount the dmg and extract the agent."""
    if sys.platform != "darwin":
        raise RuntimeError("dmg extraction is only supported on macOS")
    with tempfile.TemporaryDirectory() as mount:
        subprocess.run(["hdiutil", "attach", asset, "-mountpoint", mount, "-quiet"],
                       check=True)
        try:
            agent = find_agent(mount)
            if not agent:
                raise RuntimeError("anylink_client_agent not found in dmg")
            shutil.copy(agent, os.path.join(dest_dir, agent_name))
        finally:
            subprocess.run(["hdiutil", "detach", mount, "-quiet"],
                           check=False)


def extract_linux_tar(asset, dest_dir, agent_name):
    """Extract the agent from a linux tar.gz archive."""
    with tempfile.TemporaryDirectory() as tmp:
        with tarfile.open(asset, "r:gz") as tf:
            members = [m for m in tf.getmembers()
                       if m.name.endswith("resources/bin/anylink_client_agent")]
            if not members:
                raise RuntimeError("anylink_client_agent not found in tar.gz")
            tf.extractall(tmp, members=members, filter="data")
        agent = find_agent(tmp)
        if not agent:
            raise RuntimeError("failed to extract agent")
        shutil.copy(agent, os.path.join(dest_dir, agent_name))


def main():
    if len(sys.argv) != 3:
        log("Usage: python scripts/download-agent.py <win|mac|linux> <amd64|386|arm64|arm>")
        sys.exit(1)

    platform = sys.argv[1].lower()
    arch = sys.argv[2].lower()

    # Target file name (must match electron-builder.yml / vpnAgent/index.ts conventions)
    agent_names = {
        "win": f"anylink_client_agent-windows-{arch}.exe",
        "mac": f"anylink_client_agent-darwin-{arch}",
        "linux": f"anylink_client_agent-linux-{arch}",
    }
    if platform not in agent_names:
        log(f"Unknown platform: {platform}")
        sys.exit(1)
    agent_name = agent_names[platform]

    # Upstream release asset name (electron-builder artifact naming)
    ver = TAG.lstrip("v")
    if platform == "win":
        asset_arch = {"amd64": "x64", "386": "ia32", "arm64": "arm64"}[arch]
        asset_name = f"anylink-client-{ver}-win-{asset_arch}.exe"
    elif platform == "mac":
        asset_arch = {"amd64": "x64", "arm64": "arm64"}[arch]
        asset_name = f"anylink-client-{ver}-mac-{asset_arch}.dmg"
    elif platform == "linux":
        asset_arch = {"amd64": "x64", "arm": "armv7l", "arm64": "arm64"}[arch]
        asset_name = f"anylink-client-{ver}-linux-{asset_arch}.tar.gz"
    else:
        sys.exit(1)

    url = f"https://github.com/{REPO}/releases/download/{TAG}/{asset_name}"

    workdir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dest_dir = os.path.join(workdir, "vpnagent")
    os.makedirs(dest_dir, exist_ok=True)

    with tempfile.NamedTemporaryFile(suffix=".asset", delete=False) as tmpf:
        asset_path = tmpf.name
    try:
        download(url, asset_path)
        if platform == "win":
            extract_windows_nsis(asset_path, dest_dir, agent_name)
        elif platform == "mac":
            extract_mac_dmg(asset_path, dest_dir, agent_name)
        elif platform == "linux":
            extract_linux_tar(asset_path, dest_dir, agent_name)

        final = os.path.join(dest_dir, agent_name)
        os.chmod(final, os.stat(final).st_mode | stat.S_IEXEC)
        log(f"Saved: {final} ({os.path.getsize(final)} bytes)")
    finally:
        os.unlink(asset_path)


if __name__ == "__main__":
    main()
