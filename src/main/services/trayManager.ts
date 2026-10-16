import { app, ipcMain, Menu, Tray, BrowserWindow } from 'electron'
import path from 'path'

/**
 * 系统托盘管理：
 * - 应用常驻系统托盘，关闭/最小化窗口后进程继续在后台运行，
 *   断网后渲染进程中的重连状态机得以持续工作，网络恢复即自动重连。
 * - 托盘菜单提供「打开主界面 / 连接状态 / 退出」。
 * - 渲染进程通过 ipcRenderer.send('vpn-status', connected) 上报连接状态，
 *   托盘 tooltip 与菜单项实时同步。
 */

let tray: Tray | null = null
let showWindowCb: () => void = null
let statusLabel: string = '状态未知'

/** 解析托盘图标路径：打包后从 resources/icons 读取，开发态直接取仓库 config/icons */
function resolveIconPath(): string {
  const name = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  if (app.isPackaged) {
    // electron-builder.yml 中 extraResources 已把 config/icons 拷到 resources/icons
    return path.join(process.resourcesPath, 'icons', name)
  }
  // 开发态 __dirname = src/main/services
  return path.resolve(__dirname, '../../config/icons', name)
}

function buildContextMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: '打开主界面',
      click: () => showWindowCb && showWindowCb(),
    },
    { type: 'separator' },
    { label: statusLabel, enabled: false },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        destroyTray()
        app.quit()
      },
    },
  ])
}

function refreshTray() {
  if (!tray) return
  tray.setToolTip(`Anylink Client（${statusLabel}）`)
  tray.setContextMenu(buildContextMenu())
}

export function createTray(opts: { showWindow: () => void; onQuit: () => void }): void {
  if (tray) return
  showWindowCb = opts.showWindow
  try {
    tray = new Tray(resolveIconPath())
  } catch (err) {
    // 图标缺失等异常不应导致应用无法启动，仅放弃托盘常驻能力
    console.error('创建托盘失败:', err)
    tray = null
    return
  }
  tray.on('click', () => showWindowCb && showWindowCb())
  refreshTray()

  // 渲染进程上报 VPN 连接状态（true 已连接 / false 未连接或重连中）
  ipcMain.on('vpn-status', (_event, connected: boolean) => {
    statusLabel = connected ? '已连接' : '未连接（后台自动重连中）'
    refreshTray()
  })
}

/** Windows 任务栏气泡：首次最小化到托盘时提示用户程序仍在后台运行 */
export function showMinimizeTip(win: BrowserWindow): void {
  if (process.platform !== 'win32' || !tray) return
  try {
    tray.displayBalloon({
      iconType: 'info',
      title: 'Anylink Client 仍在后台运行',
      content: '已最小化到系统托盘。断网后会自动重连，双击托盘图标可重新打开界面。',
    })
  } catch (err) {
    console.error('显示托盘气泡失败:', err)
  }
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
