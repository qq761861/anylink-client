<template>
  <div class="app-container ">
    <div class="main-content">
      <div class="vpn-container">
        <div class="sidebar select-none">
          <div class="tab-item" :class="{ active: activeTab === 'network' }" @click="activeTab = 'network'">
            <div class="flex flex-col items-center justify-center">
              <div style="position: relative;">
                <svg-icon icon-class="network" class="icon"></svg-icon>
                <NetworkStatusDot :is-connected="m_vpnConnected" style="position: absolute; bottom: 0px;left:2px;">
                </NetworkStatusDot>
              </div>
              <div class="text">网络</div>
            </div>
          </div>
          <div class="tab-item" :class="{ active: activeTab === 'config' }" @click="activeTab = 'config'">
            <div class="flex flex-col items-center justify-center">
              <div>
                <svg-icon icon-class="setting" class="icon"></svg-icon>
              </div>
              <div class="text">配置</div>
            </div>
          </div>
        </div>

        <div class="content">
          <!-- 网络标签页 -->
          <div v-show="activeTab === 'network'" class="tab-content">
            <a-alert type="error" v-show="notInstallVpnAgent">未检测到Anylink Client AGENT<a-button size="mini" type="text"
                @click="installVpnAgent">点击修复</a-button></a-alert>
            <div class="status-container mt-6">
              <div class="status-text">
                <span class="status-indicator" :class="statusClass"></span>
                <span>{{ statusText }}</span>
              </div>
              <button class="connect-btn" :class="{ disconnect: m_vpnConnected }" @click="toggleConnection"
                :disabled="isConnecting || connectBtnDisable || disconnecting">
                {{ connectButtonText }}
              </button>
              <div class="mt-2">
                <a-tag>
                  上传：{{ formatBytes(vpnStat.bytesSent) }} | 下载：{{ formatBytes(vpnStat.bytesReceived) }}
                </a-tag>
              </div>
            </div>
            <div v-show="m_vpnConnected" class="connection-info">
              <div class="info-row">
                <div class="info-label">用户名:</div>
                <div class="info-value">{{ config.username }}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Channel Type:</div>
                <div class="info-value">{{ vpnStatus.DtlsConnected ? "DTLS" : "TLS" }}</div>
              </div>
              <div class="info-row">
                <div class="info-label">TLS CipherSuite:</div>
                <div class="info-value">{{ vpnStatus.TLSCipherSuite ? vpnStatus.TLSCipherSuite : '-' }}</div>
              </div>
              <div class="info-row">
                <div class="info-label">DTLS CipherSuite:</div>
                <div class="info-value">{{ vpnStatus.DTLSCipherSuite ? vpnStatus.DTLSCipherSuite : '-' }}</div>
              </div>
              <div class="info-row">
                <div class="info-label">DTLS Port:</div>
                <div class="info-value">{{ vpnStatus.DTLSPort ? vpnStatus.DTLSPort : '-' }}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Server Address</div>
                <div class="info-value">{{ vpnStatus.ServerAddress ? vpnStatus.ServerAddress : '-' }}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Local Address</div>
                <div class="info-value">{{ vpnStatus.LocalAddress ? vpnStatus.LocalAddress : '-' }}</div>
              </div>
              <div class="info-row">
                <div class="info-label">VPN Address</div>
                <div class="info-value">{{ vpnStatus.VPNAddress ? vpnStatus.VPNAddress : '-' }}</div>
              </div>
              <div class="info-row">
                <div class="info-label">MTU</div>
                <div class="info-value">{{ vpnStatus.MTU ? vpnStatus.MTU : '-' }}</div>
              </div>
              <div class="info-row">
                <div class="info-label">DNS</div>
                <div class="info-value">{{ vpnStatus.DNS ? vpnStatus.DNS.join(',') : '-' }}</div>
              </div>
              <div class="info-row">
                <div class="info-label">日志:</div>
                <div class="info-value" style="font-size: 12px;">{{ path.join(logPath, 'anylink_client_agent.log') }}
                </div>
              </div>
              <!-- <div class="info-row">
                <div class="info-label">连接时间:</div>
                <div class="info-value">{{ connectionTime }}</div>
              </div> -->
            </div>
          </div>

          <!-- 配置标签页 -->
          <div v-show="activeTab === 'config'" class="tab-content">
            <form @submit.prevent="saveConfig">
              <div class="form-group">
                <label for="host" class="required">服务器地址</label>
                <input type="text" id="host" v-model="config.host" placeholder="例如: 10.2.0.10:8801"
                  :class="{ error: errors.host }">
                <div v-if="errors.host" class="error-message">{{ errors.host }}</div>
              </div>

              <div class="form-group">
                <label for="username" class="required">用户名</label>
                <input type="text" id="username" v-model="config.username" placeholder="请输入用户名"
                  :class="{ error: errors.username }">
                <div v-if="errors.username" class="error-message">{{ errors.username }}</div>
              </div>

              <div class="form-group">
                <label for="password">密码</label>
                <div class="password-input-wrapper">
                  <input :type="showPassword ? 'text' : 'password'" id="password" v-model="config.password"
                    placeholder="请输入密码">
                  <button class="password-toggle" type="button" :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                    :title="showPassword ? '隐藏密码' : '显示密码'" @click="showPassword = !showPassword">
                    <icon-eye v-if="!showPassword" />
                    <icon-eye-invisible v-else />
                  </button>
                </div>
              </div>

              <div class="form-group">
                <label for="group">用户组</label>
                <input type="text" id="group" v-model="config.group" placeholder="例如: all">
              </div>

              <div v-show="false" class="form-group">
                <label for="secret">密钥</label>
                <input type="password" id="secret" v-model="config.secret" placeholder="请输入密钥">
              </div>

              <div class="form-group">
                <label for="enableOtp">OTP验证</label>
                <label class="switch-row" for="enableOtp">
                  <input id="enableOtp" v-model="config.enableOtp" class="switch-input" type="checkbox">
                  <span class="switch-control" aria-hidden="true"></span>
                </label>
              </div>
              <button type="submit" class="save-btn">保存配置</button>
            </form>
          </div>
        </div>
      </div>
    </div>
    <OtpCodeInput v-model:visible="otpDialogVisible" v-model="otpCode" :loading="isConnecting"
      @confirm="handleOtpConfirm" @cancel="handleOtpCancel" />
  </div>
</template>
<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { VpnAgentRpc } from '@renderer/utils/vpnAgentRpc';
import { ReconnectController } from '@renderer/utils/reconnectController';
import { ipcRenderer } from 'electron';
import { Message } from '@arco-design/web-vue';
import NetworkStatusDot from './components/NetworkStatusDot.vue';
import OtpCodeInput from '@renderer/components/OtpCodeInput/index.vue';
const path = require('path');

let vpnAgentRpc = null
let userData = ''
const logPath = ref('.')
let statusPollTimer = null
// VPN 断线自动重连状态机：退避调度、掉线检出、清理重试等全部逻辑集中在此，
// 视图只负责执行 RPC 动作与展示状态（逻辑见 utils/reconnectController.ts）
let reconnectCtrl = null

onMounted(async () => {
  userData = await ipcRenderer.invoke('get-userData')
  logPath.value = path.join(path.join(userData, 'anylink_client'))
  console.log('userData', userData)
  vpnAgentRpc = new VpnAgentRpc()

  // 初始化断线自动重连状态机
  reconnectCtrl = new ReconnectController(
    {
      // 发起连接：mode='reconnect' 快速重连，mode='connect' 完整重连
      connect: (mode, otp, seq) => {
        const isReconnect = mode === 'reconnect'
        const method = isReconnect ? 'reconnect' : 'connect'
        const id = isReconnect ? 4 : 2
        vpnAgentRpc.callAsyncParams(method, id, buildConnectParams(otp), (data) => {
          console.log('ws ' + method + '->:', data)
          const hasError = data.error && Object.keys(data.error).length !== 0
          const errMsg = hasError ? String(data.error.message || '') : null
          reconnectCtrl.notifyConnectResult(errMsg, seq)
        })
      },
      // 通知 agent 清理残留的虚拟网卡/会话
      cleanup: () => {
        if (vpnAgentRpc.isConnected()) {
          vpnAgentRpc.callAsync('disconnect', 3)
        }
      },
      // 向 agent 核实是否存在活跃的 VPN 连接（休眠唤醒/重连失败后的兜底核实）
      checkActive: (cb) => {
        if (!vpnAgentRpc || !vpnAgentRpc.isConnected()) {
          cb(null)
          return
        }
        vpnAgentRpc.callAsync('active', 8, (data) => {
          const hasError = data.error && Object.keys(data.error).length !== 0
          if (hasError) {
            cb(null)
            return
          }
          cb(!!data.result)
        })
      },
      isOnline: () => (typeof navigator !== 'undefined' ? navigator.onLine !== false : true),
      onUpdate: (s) => {
        const wasConnected = m_vpnConnected.value
        isConnecting.value = s.connecting
        isReconnecting.value = s.reconnecting
        m_vpnConnected.value = s.vpnConnected
        // 连接建立（含自动重连成功）后启动掉线检测轮询
        if (s.vpnConnected && !wasConnected) {
          connectBtnDisable.value = false
          startStatusPolling()
          getStatusVpn()
          getStatVpn()
        }
      },
      notify: (level, message) => {
        if (level === 'warning') Message.warning(message)
        else if (level === 'info') Message.info(message)
        else if (level === 'success') Message.success(message)
        else Message.error(message)
      },
      log: (...args) => console.log('[reconnect]', ...args)
    },
    {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
      now: () => Date.now()
    }
  )

  vpnAgentRpc.onError(msg => {
    console.log('onError', msg)
    notInstallVpnAgent.value = true
  })
  vpnAgentRpc.onOpen(msg => {
    console.log('onOpen', msg)
    console.log('vpnAgentRpc.isConnected()', vpnAgentRpc.isConnected())
    vpnAgentRpc.callAsync('active', 8, (data) => {
      console.log('active ->', data)
      if (!data.result) {
        // agent 没有活跃的 VPN 连接
        configVpn()
      } else {
        // agent 侧已有活跃连接：同步为已连接状态。
        // 状态机会通过 onUpdate 通知视图，由视图统一启动掉线检测轮询（避免重复启动）
        reconnectCtrl.markConnected()
      }
    })

    // Message.success('初始化完成')
    notInstallVpnAgent.value = false
  })
  vpnAgentRpc.onClose(msg => {
    console.log('onClose', msg)
  })
  vpnAgentRpc.onReconnecting(attempt => {
    console.log('rpc reconnecting, attempt:', attempt)
  })
  // ABORT：agent 主动通知 VPN 连接被中止/断开，这是最可靠的断线信号
  vpnAgentRpc.registerCallback(6, (res) => {
    console.log('ABORT', res)
    reconnectCtrl.notifyDropped('ABORT')
  })
  // DISCONNECT：断开完成（用户主动断开或异常断开都会触发）
  vpnAgentRpc.registerCallback(3, (res) => {
    console.log('DISCONNECT', res)
    disconnecting.value = false
    reconnectCtrl.notifyDropped('DISCONNECT')
  })
  vpnAgentRpc.connectToServer('ws://127.0.0.1:7210/rpc')

  // 监听系统网络状态变化：断网立即进入重连，网络恢复立即重连
  window.addEventListener('online', handleNetworkOnline)
  window.addEventListener('offline', handleNetworkOffline)

  ipcRenderer.on('vpnagent-log', (event, message) => {
    console.log(message)
  });
  ipcRenderer.on('vpnagent-log-err', (event, message) => {
    console.log('err:' + message)
  });

  ipcRenderer.invoke('read-config').then(res => {
    if (Object.keys(res).length !== 0) {
      config.host = res.host
      config.username = res.username
      config.password = res.password
      config.group = res.group
      config.secret = res.group
      config.enableOtp = Boolean(res.enableOtp)
    }
  })

})

const connectBtnDisable = ref(true)
function configVpn() {
  connectBtnDisable.value = true
  vpnAgentRpc.callAsyncParams('config', 1, {
    log_level: 'debug',
    log_path: logPath.value,
    skip_verify: true,
    cisco_compat: true,
    no_dtls: false,
    agent_name: 'anylink_client_agent',
    agent_version: '1.0.0'
  }, (data) => {
    if (data.result === 'ready to connect') {
      connectBtnDisable.value = false
    }
    console.log('ws config->:', data)
  })
}

function buildConnectParams(otp = '') {
  const params = {
    host: config.host,
    username: config.username,
    password: config.password,
    group: config.group,
    secret: config.secret
  }

  if (config.enableOtp && otp) {
    params.password += otp
  }

  return params
}

function connectVpn(reconnect, otp = '') {
  if (!reconnectCtrl) return
  // 手动点击连接：解除"主动断开"抑制，避免后续掉线信号被永久忽略
  reconnectCtrl.markManualConnectStart()
  if (vpnAgentRpc.isConnected()) {
    // 由状态机统一发起：它会记录在途尝试序号并挂上看门狗（断网时 10s 判定失败）
    reconnectCtrl.beginAttempt(reconnect ? 'reconnect' : 'connect', otp)
  } else {
    // RPC 尚未连接（agent 可能正在重启）：交由状态机决定继续等待或清理重试
    reconnectCtrl.notifyRpcUnavailable()
  }
}

function disconnectVpn() {
  disconnecting.value = true
  // 停止自动重连与状态轮询，并复位掉线判定计数
  reconnectCtrl && reconnectCtrl.markManualDisconnect()
  stopStatusPolling()
  if (vpnAgentRpc.isConnected()) {
    vpnAgentRpc.callAsync('disconnect', 3)
  } else {
    disconnecting.value = false
  }
}

const vpnStatus = ref({})
function getStatusVpn() {
  vpnAgentRpc.callAsync('status', 0, (data) => {
    if (m_vpnConnected.value) {
      vpnStatus.value = data.result ? data.result : {}
    }
    console.log('ws status->:', data)
    // 掉线判定交给状态机做防抖（连续失败多次才算掉线），避免单次瞬时错误误判
    const hasError = data.error && Object.keys(data.error).length !== 0
    const emptyResult = !data.result || Object.keys(data.result).length === 0
    if (hasError || emptyResult) {
      reconnectCtrl && reconnectCtrl.notifyPollFailure()
    } else {
      reconnectCtrl && reconnectCtrl.notifyPollSuccess()
    }
  })
}

// 周期轮询 VPN 状态，用于在 VPN 意外掉线时及时发现并自动重连
function startStatusPolling() {
  stopStatusPolling()
  statusPollTimer = setInterval(() => {
    if (!m_vpnConnected.value || isConnecting.value) {
      return
    }
    getStatusVpn()
  }, 5000)
}

function stopStatusPolling() {
  if (statusPollTimer) {
    clearInterval(statusPollTimer)
    statusPollTimer = null
  }
}

// 系统网络恢复：交给状态机，放弃挂起的尝试并立即重连
function handleNetworkOnline() {
  console.log('系统网络已恢复')
  reconnectCtrl && reconnectCtrl.notifyNetworkOnline()
}

// 系统网络丢失：状态机会立即判定 VPN 已断并进入重连，无需等待轮询连续失败
function handleNetworkOffline() {
  console.log('系统网络已断开')
  reconnectCtrl && reconnectCtrl.notifyNetworkOffline()
}
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

onUnmounted(() => {
  m_vpnConnected.value = false
  stopStatusPolling()
  reconnectCtrl && reconnectCtrl.destroy()
  window.removeEventListener('online', handleNetworkOnline)
  window.removeEventListener('offline', handleNetworkOffline)
})
const vpnStat = ref({
  bytesSent: 0,
  bytesReceived: 0
})

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'

  let unit = "B"
  let value = bytes

  if (bytes < 1024) {
    unit = "B"
  } else if (bytes < 1024 * 1024) {
    value = bytes / 1024
    unit = "KB"
  } else if (bytes < 1024 * 1024 * 1024) {
    value = bytes / (1024 * 1024)
    unit = "MB"
  } else {
    value = bytes / (1024 * 1024 * 1024)
    unit = "GB"
  }

  return `${value.toFixed(2)} ${unit}`
}
async function getStatVpn() {
  vpnAgentRpc.callAsync('stat', 7, async (data) => {
    console.log('ws stat->:', data)
    if (m_vpnConnected.value && !data.error) {
      vpnStat.value = data.result
      // stat 正常，通知状态机复位掉线判定计数
      reconnectCtrl && reconnectCtrl.notifyPollSuccess()
      await sleep(1000);
      getStatVpn()
    } else if (m_vpnConnected.value && data.error) {
      // stat 请求返回错误：交给状态机做防抖计数（连续多次失败才判定掉线）
      reconnectCtrl && reconnectCtrl.notifyPollFailure()
    }
  })
}


const notInstallVpnAgent = ref(false)

function installVpnAgent() {
  ipcRenderer.invoke('reinstall-vpnagent').then((res) => {
    Message.success("安装成功")
    activeTab.value = 'network'
    notInstallVpnAgent.value = false
  }).catch(err => {
    const match = err.message.match(/Error: (.+)$/);
    const errorMsg = match ? match[1] : err.message;
    Message.error(errorMsg || '安装失败')
  })
}

const activeTab = ref('network')
const m_vpnConnected = ref(false)
const isConnecting = ref(false)
const connectionTime = ref('')

const defaultConfig = {
  host: "",
  username: "",
  password: "",
  group: "",
  secret: "",
  enableOtp: false
}

const config = reactive({ ...defaultConfig })
const showPassword = ref(false)
const errors = reactive({
  host: '',
  username: ''
})

const disconnecting = ref(false)
// 是否正在自动重连（区分于首次手动连接）
const isReconnecting = ref(false)
const statusClass = computed(() => {
  if (isReconnecting.value) return 'status-connecting'
  if (isConnecting.value) return 'status-connecting'
  return m_vpnConnected.value ? 'status-connected' : 'status-disconnected'
})

const statusText = computed(() => {
  if (isReconnecting.value) return '重连中...'
  if (isConnecting.value) return '连接中...'
  if (disconnecting.value) return '断开中...'
  return m_vpnConnected.value ? '已连接' : '未连接'
})

const connectButtonText = computed(() => {
  return m_vpnConnected.value ? '断开连接' : '立即连接'
})

const otpDialogVisible = ref(false)
const otpCode = ref('')

const validateConfig = () => {
  let isValid = true
  errors.host = ''
  errors.username = ''

  if (!config.host?.trim()) {
    errors.host = '服务器地址不能为空'
    isValid = false
  }

  if (!config.username?.trim()) {
    errors.username = '用户名不能为空'
    isValid = false
  }

  return isValid
}

const toggleConnection = async () => {
  if (m_vpnConnected.value) {
    m_vpnConnected.value = false
    connectionTime.value = ''
    disconnectVpn()
  } else {
    if (!validateConfig()) {
      activeTab.value = 'config'
      return
    }
    if (config.enableOtp) {
      otpCode.value = ''
      otpDialogVisible.value = true
      return
    }
    startConnect()
  }
}

function startConnect(otp = '') {
  // 手动连接：状态机会解除"主动断开"抑制并复位退避计数
  connectVpn(false, otp)
  connectionTime.value = new Date().toLocaleString()
}

function handleOtpConfirm(code) {
  otpDialogVisible.value = false
  startConnect(code)
}

function handleOtpCancel() {
  otpCode.value = ''
}

const saveConfig = () => {
  if (validateConfig()) {
    ipcRenderer.invoke('save-config', { ...config })
    Message.info('配置已保存')
  }
}


</script>
<style lang="scss" scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 30px);
  position: relative;
}

.main-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
}


.vpn-container {
  display: flex;
  height: calc(100vh - 30px);
  background: white;
  overflow: hidden;
}

.sidebar {
  width: 80px;
  background-color: #f5f7fa;
  border-right: 1px solid #e4e7ed;
  padding: 80px 0;
  background-color: #2B94FF;
}

.tab-item {
  padding: 15px 20px;
  cursor: pointer;
}

.tab-item .icon {
  color: #ABD4FD;
  font-size: 24px;
}

.tab-item.active .icon {
  transform: scale(110%);
}

.tab-item .text {
  font-size: 14px;
  font-weight: bolder;
  color: #ABD4FD;
  margin-top: 2px;
}

.tab-item.active {
  color: #ABD4FD;
  background-color: #2A8BEE;

  .icon,
  .text {
    color: #fff;
  }
}


/* .tab-item:hover {
  background-color: #2A8BEE;
} */

.content {
  flex: 1;
  padding: 10px;
  overflow-y: auto;
}

.status-container {
  text-align: center;
}

.status-text {
  font-size: 18px;
  margin-bottom: 10px;
}

.status-indicator {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  margin-right: 8px;
}

.status-connected {
  background-color: #67c23a;
}

.status-disconnected {
  background-color: #f56c6c;
}

.status-connecting {
  background-color: #e6a23c;
}

.connect-btn {
  background-color: #409eff;
  color: white;
  border: none;
  padding: 12px 30px;
  border-radius: 4px;
  font-size: 16px;
  cursor: pointer;
  transition: all 0.3s;
}

.connect-btn:hover {
  background-color: #66b1ff;
}

.connect-btn:active {
  background-color: #3a8ee6;
}

.connect-btn.disconnect {
  background-color: #f56c6c;
}

.connect-btn.disconnect:hover {
  background-color: #f78989;
}

.connect-btn:disabled {
  background-color: #c0c4cc;
  cursor: not-allowed;
}

.form-group {
  margin-bottom: 20px;
}

label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
}

.required::after {
  content: "*";
  color: #f56c6c;
  margin-left: 4px;
}

input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  font-size: 14px;
  transition: border-color 0.3s;
}

input:focus {
  outline: none;
  border-color: #409eff;
}

.password-input-wrapper {
  position: relative;
}

.password-input-wrapper input {
  padding-right: 40px;
}

.password-toggle {
  position: absolute;
  top: 50%;
  right: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: #86909c;
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
  transform: translateY(-50%);
}

.password-toggle:hover {
  color: #409eff;
  background: #f2f3f5;
}

.password-toggle:focus-visible {
  outline: 2px solid rgba(64, 158, 255, 0.45);
  outline-offset: 1px;
}

.switch-row {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 0;
  color: #303133;
  font-weight: 400;
  cursor: pointer;
  user-select: none;
}

.switch-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.switch-control {
  position: relative;
  width: 44px;
  height: 24px;
  background: #c0c4cc;
  border-radius: 12px;
  transition: background-color 0.2s ease;
}

.switch-control::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  background: #ffffff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
  transition: transform 0.2s ease;
}

.switch-input:checked+.switch-control {
  background: #409eff;
}

.switch-input:checked+.switch-control::after {
  transform: translateX(20px);
}

.switch-input:focus+.switch-control {
  box-shadow: 0 0 0 3px rgba(64, 158, 255, 0.18);
}

.error {
  border-color: #f56c6c;
}

.error-message {
  color: #f56c6c;
  font-size: 12px;
  margin-top: 5px;
}

.save-btn {
  background-color: #409eff;
  color: white;
  border: none;
  padding: 12px 30px;
  border-radius: 4px;
  font-size: 16px;
  cursor: pointer;
  transition: all 0.3s;
  margin-top: 10px;
}

.save-btn:hover {
  background-color: #66b1ff;
}

.save-btn:active {
  background-color: #3a8ee6;
}

.connection-info {
  background-color: #f5f7fa;
  padding: 15px;
  border-radius: 4px;
  margin-top: 12px;
  font-size: 14px;
}

.info-row {
  display: flex;
  margin-bottom: 8px;
}

.info-label {
  width: 150px;
  color: #909399;
}

.info-value {
  flex: 1;
}
</style>
