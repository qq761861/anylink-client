import setIpc from './ipcMain'
import menuconfig from '../config/menu'
import { createTray, showMinimizeTip } from './trayManager'

import { app, BrowserWindow, Menu, dialog } from 'electron'
import { platform } from 'os'
import { winURL, loadingURL } from '../config/StaticPath'
import { openDevTools, IsUseSysTitle, UseStartupChart } from '../config/const'

class MainInit {

  public winURL: string = ''
  public shartURL: string = ''
  public loadWindow: BrowserWindow = null
  public mainWindow: BrowserWindow = null
  // 是否正在退出应用：true 时关闭窗口走真实关闭（托盘「退出」按钮）
  public isQuitting = false
  // 是否已提示过「最小化到托盘」（只提示一次，避免打扰）
  public hideTipShown = false

  constructor() {
    console.log("process.env.userConfig",process.env.userConfig)
    console.log("process.env.MAVEN_HOME",process.env.MAVEN_HOME)
    this.winURL = winURL
    this.shartURL = loadingURL
    if (process.env.NODE_ENV === 'development') {
      menuconfig.push({
        label: '开发者设置',
        submenu: [{
          label: '切换到开发者模式',
          accelerator: 'CmdOrCtrl+I',
          role: 'toggledevtools'
        }]
      })
    }
    // 启用协议，这里暂时只用于自定义头部的时候使用
    setIpc.Mainfunc(IsUseSysTitle)
  }
  // 主窗口函数
  createMainWindow() {
    this.mainWindow = new BrowserWindow({
      useContentSize: true,
      width: 680,
      height: 600,
      minWidth: 680,
      minHeight: 600,
      // maxWidth: 580,
      // maxHeight: 400,
      show: false,
      frame: IsUseSysTitle,
      titleBarStyle: platform().includes('win32') ? 'default' : 'hidden',
      webPreferences: {
        sandbox:false,
        // 禁用渲染进程的上下文隔离
        contextIsolation: false,
        // 渲染进程将具有完整的Node.js环境
        nodeIntegration: true,
        nodeIntegrationInWorker: true,
        webSecurity: false,
        // 关键：窗口隐藏到托盘后不节流定时器，保证断网重连状态机在后台全速运行
        backgroundThrottling: false,
        // 如果是开发模式可以使用devTools
        devTools: process.env.NODE_ENV === 'development' || openDevTools,
        // devTools: true,
        // 在macos中启用橡皮动画
        scrollBounce: process.platform === 'darwin'
      }
    })
    // 赋予模板
    const menu = Menu.buildFromTemplate(menuconfig as any)
    // 加载模板
    Menu.setApplicationMenu(menu)
    // 自定义应用菜单会替换 Electron 默认菜单。保留标准编辑快捷键，
    // 并在页面脚本拦截键盘事件时通过 webContents 执行原生编辑操作。
    this.mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || (!input.control && !input.meta)) return

      const key = input.key.toLowerCase()
      const editActions = {
        a: 'selectAll',
        c: 'copy',
        x: 'cut',
        v: 'paste'
      } as const
      const action = editActions[key as keyof typeof editActions]
      if (!action) return

      event.preventDefault()
      this.mainWindow.webContents[action]()
    })
    // 加载主窗口
    this.mainWindow.loadURL(this.winURL)
    // dom-ready之后显示界面
    this.mainWindow.webContents.once('dom-ready', () => {
      this.mainWindow.show()
      if (UseStartupChart) this.loadWindow.destroy()
    })
    // 开发模式下自动开启devtools（生产环境不打开）
    if (process.env.NODE_ENV === 'development' || openDevTools) {
      this.mainWindow.webContents.openDevTools({ mode: 'undocked', activate: true })
    }

    // 当确定渲染进程卡死时，分类型进行告警操作
    // 先清理已有监听器，避免窗口重建时重复注册（createMainWindow 可能被多次调用）
    app.removeAllListeners('render-process-gone')
    app.on('render-process-gone', (event, webContents, details) => {
      const message = {
        title: "警告",
        buttons: ['确定', '退出'],
        message: '',
      }
      switch (details.reason) {
        case 'crashed':
          message.message = "图形化进程崩溃，是否进行软重启操作？"
          break;
        case 'killed':
          message.message = "由于未知原因导致图形化进程被终止，是否进行软重启操作？"
          break;
        case 'oom':
          message.message = "内存不足，是否软重启释放内存？"
          break;
        default:
          message.message = `图形化进程异常退出（原因：${details.reason || 'unknown'}），是否进行软重启操作？`
          break;
      }
      dialog.showMessageBox(this.mainWindow, {
        type: 'warning',
        title: message.title,
        buttons: message.buttons,
        message: message.message,
        noLink: true
      }).then(res => {
        if (res.response === 0) this.mainWindow.reload()
        else this.mainWindow.close()
      })
    })
    // 不知道什么原因，反正就是这个窗口里的页面触发了假死时执行
    this.mainWindow.on('unresponsive', () => {
      dialog.showMessageBox(this.mainWindow, {
        type: 'warning',
        title: '警告',
        buttons: ['重载', '退出'],
        message: '图形化进程失去响应，是否等待其恢复？',
        noLink: true
      }).then(res => {
        if (res.response === 0) this.mainWindow.reload()
        else this.mainWindow.close()
      })
    })
    /**
     * 新的gpu崩溃检测，详细参数详见：http://www.electronjs.org/docs/api/app
     * @returns {void}
     * @author zmr (umbrella22)
     * @date 2020-11-27
     */
    // 先清理已有监听器，避免窗口重建时重复注册
    app.removeAllListeners('child-process-gone')
    app.on('child-process-gone', (event, details) => {
      // 只处理 GPU 子进程崩溃；其它子进程崩溃无需弹窗打扰用户
      if (details.type !== 'GPU') return
      const message = {
        title: "警告",
        buttons: ['确定', '退出'],
        message: '',
      }
      switch (details.reason) {
        case 'crashed':
          message.message = "硬件加速进程已崩溃，是否关闭硬件加速并重启？"
          break;
        case 'killed':
          message.message = "硬件加速进程被意外终止，是否关闭硬件加速并重启？"
          break;
        default:
          message.message = `硬件加速进程异常退出（原因：${details.reason || 'unknown'}），是否关闭硬件加速并重启？`
          break;
      }
      dialog.showMessageBox(this.mainWindow, {
        type: 'warning',
        title: message.title,
        buttons: message.buttons,
        message: message.message,
        noLink: true
      }).then(res => {
        // 当显卡出现崩溃现象时使用该设置禁用显卡加速模式。
        if (res.response === 0) {
          if (details.type === 'GPU') app.disableHardwareAcceleration();
          this.mainWindow.reload()
        } else {
          this.mainWindow.close()
        }
      })
    })
    this.mainWindow.on('closed', () => {
      this.mainWindow = null
    })
    // 关闭窗口 = 最小化到系统托盘：进程与 VPN 断线重连逻辑继续在后台运行，
    // 网络恢复后自动重连。真正退出需通过托盘菜单的「退出」。
    this.mainWindow.on('close', (event) => {
      if (this.isQuitting) return
      event.preventDefault()
      this.mainWindow.hide()
      if (!this.hideTipShown) {
        this.hideTipShown = true
        showMinimizeTip(this.mainWindow)
      }
    })
    // 创建系统托盘（常驻后台的入口）
    createTray({
      showWindow: () => this.showMainWindow(),
      onQuit: () => {
        this.isQuitting = true
        app.quit()
      }
    })
  }
  // 从托盘重新打开主界面
  showMainWindow() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      this.createMainWindow()
      return
    }
    if (this.mainWindow.isMinimized()) this.mainWindow.restore()
    this.mainWindow.show()
    this.mainWindow.focus()
  }
  // 加载窗口函数
  loadingWindow(loadingURL: string) {
    this.loadWindow = new BrowserWindow({
      width: 400,
      height: 600,
      frame: false,
      skipTaskbar: true,
      transparent: true,
      resizable: false,
      webPreferences: { experimentalFeatures: true }
    })

    this.loadWindow.loadURL(loadingURL)
    this.loadWindow.show()
    this.loadWindow.setAlwaysOnTop(true)
    // 延迟两秒可以根据情况后续调快，= =，就相当于个，sleep吧，就那种。 = =。。。
    setTimeout(() => {
      this.createMainWindow()
    }, 1500)
  }
  // 初始化窗口函数
  initWindow() {
    if (UseStartupChart) {
      return this.loadingWindow(this.shartURL)
    } else {
      return this.createMainWindow()
    }

  }
}
export default MainInit
