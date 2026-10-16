'use strict'
import { app } from 'electron'
import InitWindow from './services/windowManager'
import { destroyTray } from './services/trayManager'
import DisableButton from './config/DisableButton'
import electronDevtoolsInstaller, { VUEJS_DEVTOOLS } from 'electron-devtools-installer'
import { DisableF12 } from './config/const'

let backendProcess = null;

function onAppReady() {
  new InitWindow().initWindow()
  DisableF12 && DisableButton.Disablef12()
  if(process.env.NODE_ENV === 'development') {
    electronDevtoolsInstaller(VUEJS_DEVTOOLS)
      .then((name) => console.log(`已安装: ${name}`))
      .catch(err => console.log('无法安装 `vue-devtools`: \n 可能发生得错误：网络连接问题 \n', err))
  }
}

app.isReady() ? onAppReady() : app.on('ready', onAppReady)
// 由于9.x版本问题，需要加入该配置关闭跨域问题
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors')

app.on('will-quit', () => {
    if (backendProcess) backendProcess.kill();
    destroyTray();
});
// 应用常驻系统托盘：即使所有窗口关闭也不退出，
// 保证断网后重连状态机仍在后台运行（真正退出走托盘菜单「退出」）
app.on('window-all-closed', () => {})
app.on('browser-window-created', () => {
  console.log('window-created')
})

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.removeAsDefaultProtocolClient('ANYLINK-CLIENT')
    console.log('由于框架特殊性开发环境下无法使用')
  }
} else {
  app.setAsDefaultProtocolClient('ANYLINK-CLIENT')
}
