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
import { ipcRenderer } from 'electron';
import { Message } from '@arco-design/web-vue';
import NetworkStatusDot from './components/NetworkStatusDot.vue';
import OtpCodeInput from '@renderer/components/OtpCodeInput/index.vue';
const path = require('path');

let activeDisconnect = false
let vpnAgentRpc = null
let userData = ''
const logPath = ref('.')
// 断网重连相关状态
let reconnectTimer = null
let reconnectAttempt = 0
const RECONNECT_BASE_DELAY = 3000 // ms
const MAX_RECONNECT_DELAY = 30000 // ms
// 重连总时长上限：10 分钟内持续尝试重连，超时仍未成功则停止
const RECONNECT_TIMEOUT = 10 * 60 * 1000 // 10 分钟
let reconnectStartTime = 0 // 首次开始重连的时间戳
let wasConnectedBeforeDisconnect = false // 记录断线前是否处于已连接状态
let statusPollTimer = null
let networkLost = false // 系统网络是否丢失

onMounted(async () => {
  userData = await ipcRenderer.invoke('get-userData')
  logPath.value = path.join(path.join(userData, 'anylink_client'))
  console.log('userData', userData)
  vpnAgentRpc = new VpnAgentRpc()

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
        configVpn()
      } else {
        m_vpnConnected.value = true
        wasConnectedBeforeDisconnect = true
        connectBtnDisable.value = false
        getStatVpn()
        getStatusVpn()
        // 开始周期性检测 VPN 连接状态，发现掉线自动重连
        startStatusPolling()
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
  // ABORT
  vpnAgentRpc.registerCallback(6, (res) => {
    console.log('ABORT', res)
    if (!activeDisconnect) {
      setTimeout(() => {
        console.log('ABORT timout')
        connectVpn(true)
      }, 1500)
    }
  })
  // DISCONNECT
  vpnAgentRpc.registerCallback(3, (res) => {
    console.log('DISCONNECT', res)
    disconnecting.value = false
    if (!activeDisconnect) {
      setTimeout(() => {
        console.log('DISCONNECT timout')
        connectVpn(true)
      }, 1500)
    }
  })
  vpnAgentRpc.connectToServer('ws://127.0.0.1:7210/rpc')

  // 监听系统网络状态变化，网络恢复后自动重连
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
  if (vpnAgentRpc.isConnected()) {
    let method = 'connect'
    let id = 2
    if (reconnect) {
      method = 'reconnect'
      id = 4
    }
    isConnecting.value = true
    vpnAgentRpc.callAsyncParams(method, id, buildConnectParams(otp), (data) => {
      isConnecting.value = false

      console.log('ws ' + method + '->:', data)
      if (data.error && Object.keys(data.error).length !== 0) {
        if (reconnect) {
          // 当快速重连失败，再次尝试完全重新连接，用于服务端可能已经移除session的情况
          setTimeout(() => {
            console.log('connectVpn timeout')
            if (!activeDisconnect) {
              connectVpn()
            }
          }, 3000)
          // 若已达到重连上限，由 scheduleReconnect 兜底提示
        } else {
          Message.error(data.error.message)
        }
      } else {
        onVpnConnected()
      }
    })
  }

}

function disconnectVpn() {
  disconnecting.value = true
  // 主动断开：停止自动重连与状态轮询
  activeDisconnect = true
  wasConnectedBeforeDisconnect = false
  isReconnecting.value = false
  resetReconnect()
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
    // 检测 VPN 是否已断开：请求返回错误或 result 为空说明连接已失效
    if (m_vpnConnected.value && !activeDisconnect) {
      const hasError = data.error && Object.keys(data.error).length !== 0
      const emptyResult = !data.result || Object.keys(data.result).length === 0
      if (hasError || emptyResult) {
        console.log('检测到 VPN 连接已断开，准备自动重连', data)
        handleVpnDropped()
      }
    }
  })
}

// 周期轮询 VPN 状态，用于在 VPN 意外掉线时及时发现并自动重连
function startStatusPolling() {
  stopStatusPolling()
  statusPollTimer = setInterval(() => {
    if (!m_vpnConnected.value || activeDisconnect || isConnecting.value) {
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

// 系统网络恢复
function handleNetworkOnline() {
  console.log('系统网络已恢复')
  networkLost = false
  // 网络恢复后，如果 VPN 之前处于连接状态（或正在重连），则尝试自动重连
  if (wasConnectedBeforeDisconnect && !activeDisconnect && !m_vpnConnected.value) {
    if (!isConnecting.value) {
      console.log('网络恢复，自动重连 VPN')
      resetReconnect()
      connectVpn(true)
    }
  }
}

// 系统网络丢失
function handleNetworkOffline() {
  console.log('系统网络已断开')
  networkLost = true
}
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

onUnmounted(() => {
  m_vpnConnected.value = false
  stopStatusPolling()
  resetReconnect()
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
      await sleep(1000);
      getStatVpn()
    }
  })
}

function reconnectVpn() {
  vpnAgentRpc.callAsync('reconnect', 4, (data) => {
    console.log('ws reconnect->:', data)
  })
}

// ===== 断网自动重连逻辑 =====

// 重置重连状态
function resetReconnect() {
  reconnectAttempt = 0
  reconnectStartTime = 0
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

// 计算退避延迟：3s, 6s, 12s, 24s, 30s（封顶）
function getReconnectDelay() {
  const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempt), MAX_RECONNECT_DELAY)
  return delay
}

// VPN 意外掉线时的处理入口
function handleVpnDropped() {
  if (activeDisconnect) {
    return
  }
  m_vpnConnected.value = false
  wasConnectedBeforeDisconnect = true
  scheduleReconnect()
}

// 调度自动重连（10 分钟内持续重连，指数退避）
function scheduleReconnect() {
  if (reconnectTimer) {
    return
  }
  // 用户主动断开则不重连
  if (activeDisconnect) {
    return
  }
  // 系统网络丢失时先暂停重连，等待网络恢复事件
  if (networkLost) {
    console.log('系统网络未恢复，暂不重连')
    return
  }
  // 首次重连时记录开始时间
  if (reconnectStartTime === 0) {
    reconnectStartTime = Date.now()
  }
  // 超过 10 分钟仍未成功，停止自动重连
  if (Date.now() - reconnectStartTime >= RECONNECT_TIMEOUT) {
    console.log('重连已超过 10 分钟，停止自动重连')
    isConnecting.value = false
    isReconnecting.value = false
    Message.warning('网络连接失败，已持续重连 10 分钟，请检查网络后手动重试')
    return
  }

  const delay = getReconnectDelay()
  reconnectAttempt++
  isConnecting.value = true
  isReconnecting.value = true
  const elapsed = Math.floor((Date.now() - reconnectStartTime) / 1000)
  console.log(`第 ${reconnectAttempt} 次重连（已持续 ${elapsed}s），延迟 ${delay}ms`)

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (activeDisconnect) {
      isConnecting.value = false
      isReconnecting.value = false
      return
    }
    connectVpn(true)
  }, delay)
}

// 连接成功后重置重连状态
function onVpnConnected() {
  resetReconnect()
  m_vpnConnected.value = true
  wasConnectedBeforeDisconnect = true
  isConnecting.value = false
  isReconnecting.value = false
  activeDisconnect = false
  startStatusPolling()
  getStatusVpn()
  getStatVpn()
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
  isReconnecting.value = false
  resetReconnect()
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
