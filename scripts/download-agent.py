#!/usr/bin/env python3
"""
下载并准备 anylink_client_agent 二进制文件到 vpnagent/ 目录。

anylink_client_agent 是独立编译产物，不随源码仓库分发。
本脚本从上游 anylink-client 的 release 安装包中提取对应平台的 agent 二进制。

用法:
  python scripts/download-agent.py <platform> <arch>

  platform: win | mac | linux
  arch:     amd64 | 386 | arm64 | arm

环境变量:
  AGENT_RELEASE_TAG  上游 release tag（默认 v1.0.1）
  AGENT_RELEASE_REPO 上游仓库（默认 jarryxy/anylink-client）
"""
import os
import sys
import stat
import shutil
import tarfile
import tempfile
import subprocess
import urllib.request

# Windows 默认控制台编码可能不是 UTF-8（如 cp1252），会导致中文日志输出报错。
# 强制将标准输出/错误流重配置为 UTF-8，避免 UnicodeEncodeError。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

REPO = os.environ.get("AGENT_RELEASE_REPO", "jarryxy/anylink-client")
TAG = os.environ.get("AGENT_RELEASE_TAG", "v1.0.1")


def log(msg):
    print(msg, flush=True)


def download(url, dest):
    log(f"下载: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "anylink-client-ci"})
    with urllib.request.urlopen(req) as resp, open(dest, "wb") as f:
        shutil.copyfileobj(resp, f)


def find_agent(root):
    """递归查找 anylink_client_agent 二进制"""
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            if "anylink_client_agent" in name:
                return os.path.join(dirpath, name)
    return None


def extract_windows_nsis(asset, dest_dir, agent_name):
    """使用 7z 提取 Windows NSIS 安装包"""
    candidates = [
        "7z",
        "7za",
        r"C:\Program Files\7-Zip\7z.exe",
        r"C:\Program Files (x86)\7-Zip\7z.exe",
    ]
    seven_zip = None
    for c in candidates:
        if shutil.which(c):
            seven_zip = c
            break
    if not seven_zip:
        # 尝试在 runner 上通过 choco 安装，或提示
        log("未找到 7z，尝试使用 Windows runner 自带工具")
        raise RuntimeError("未找到 7z，无法解压 NSIS 安装包")

    with tempfile.TemporaryDirectory() as tmp:
        log(f"使用 {seven_zip} 解压 NSIS 安装包")
        subprocess.run([seven_zip, "x", "-y", f"-o{tmp}", asset],
                       check=True, stdout=subprocess.DEVNULL)
        agent = find_agent(tmp)
        if not agent:
            raise RuntimeError("未在 NSIS 包中找到 anylink_client_agent")
        shutil.copy(agent, os.path.join(dest_dir, agent_name))


def extract_mac_dmg(asset, dest_dir, agent_name):
    """挂载 dmg 提取 agent"""
    if sys.platform != "darwin":
        raise RuntimeError("dmg 提取仅在 macOS 上支持")
    with tempfile.TemporaryDirectory() as mount:
        subprocess.run(["hdiutil", "attach", asset, "-mountpoint", mount, "-quiet"],
                       check=True)
        try:
            agent = find_agent(mount)
            if not agent:
                raise RuntimeError("未在 dmg 中找到 anylink_client_agent")
            shutil.copy(agent, os.path.join(dest_dir, agent_name))
        finally:
            subprocess.run(["hdiutil", "detach", mount, "-quiet"],
                           check=False)


def extract_linux_tar(asset, dest_dir, agent_name):
    """解压 linux tar.gz 提取 agent"""
    with tempfile.TemporaryDirectory() as tmp:
        with tarfile.open(asset, "r:gz") as tf:
            members = [m for m in tf.getmembers()
                       if m.name.endswith("resources/bin/anylink_client_agent")]
            if not members:
                raise RuntimeError("未在 tar.gz 中找到 anylink_client_agent")
            tf.extractall(tmp, members=members, filter="data")
        agent = find_agent(tmp)
        if not agent:
            raise RuntimeError("提取 agent 失败")
        shutil.copy(agent, os.path.join(dest_dir, agent_name))


def main():
    if len(sys.argv) != 3:
        log("用法: python scripts/download-agent.py <win|mac|linux> <amd64|386|arm64|arm>")
        sys.exit(1)

    platform = sys.argv[1].lower()
    arch = sys.argv[2].lower()

    # 目标文件名（与 electron-builder.yml / vpnAgent/index.ts 约定一致）
    agent_names = {
        "win": f"anylink_client_agent-windows-{arch}.exe",
        "mac": f"anylink_client_agent-darwin-{arch}",
        "linux": f"anylink_client_agent-linux-{arch}",
    }
    if platform not in agent_names:
        log(f"未知平台: {platform}")
        sys.exit(1)
    agent_name = agent_names[platform]

    # 上游 release 资产名（electron-builder 产物命名）
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
        log(f"已保存: {final} ({os.path.getsize(final)} bytes)")
    finally:
        os.unlink(asset_path)


if __name__ == "__main__":
    main()
