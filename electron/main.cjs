/**
 * Electron 主进程。
 *
 * 为什么用自定义的 `app://` 协议而不是 `file://`：
 * 应用的全部数据都存在 localStorage 里（见 store/persist.ts）。file:// 属于
 * opaque origin，Chromium 对它的 localStorage 支持不稳定，换版本就可能丢数据。
 * 注册一个 standard + secure 的 app:// 协议可以得到一个稳定的来源，
 * localStorage 会正常落在用户数据目录里，卸载重装应用也不会丢待办。
 */

'use strict'

const { app, BrowserWindow, Menu, dialog, net, protocol, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const DIST_DIR = path.join(__dirname, '..', 'dist')
const INDEX_FILE = path.join(DIST_DIR, 'index.html')
// 开发时可以让 Electron 直接连 vite 的开发服务器：设置 ELECTRON_START_URL 即可
const DEV_URL = process.env.ELECTRON_START_URL || ''
const START_URL = DEV_URL || 'app://local/index.html'

// 必须在 app ready 之前声明，否则 app:// 会被当成普通（非标准）协议
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

/**
 * 固定用户数据目录名。
 * 默认规则是取 package.json 的 name 或 productName，开发运行与打包运行、
 * 不同打包配置之间很容易落到不同目录（%APPDATA%\todolist 与 %APPDATA%\TodoList），
 * 那会让用户升级后以为「待办全没了」。必须在 ready 之前调用才生效。
 */
app.setName('TodoList')

function registerAppProtocol() {
  protocol.handle('app', (request) => {
    let pathname
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname)
    } catch {
      return new Response('Bad Request', { status: 400 })
    }

    if (pathname === '/' || pathname === '') pathname = '/index.html'

    const resolved = path.normalize(path.join(DIST_DIR, pathname))
    // 防目录穿越：解析后必须仍在 dist 目录内
    if (resolved !== DIST_DIR && !resolved.startsWith(DIST_DIR + path.sep)) {
      return new Response('Forbidden', { status: 403 })
    }

    // 应用没有前端路由；找不到的文件一律回落到 index.html
    const target = fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? resolved : INDEX_FILE
    return net.fetch(pathToFileURL(target).toString())
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 380,
    minHeight: 520,
    show: false,
    backgroundColor: '#f5f6f8',
    title: '今日待办',
    autoHideMenuBar: true,
    webPreferences: {
      // 纯静态页面，不需要任何 Node 能力，全部关掉最安全
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  win.once('ready-to-show', () => win.show())
  win.loadURL(START_URL)

  // 页面里的外链交给系统浏览器，不在应用窗口里打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // 页面内跳转到外部地址时同样拦下来
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://')) {
      event.preventDefault()
      if (/^https?:/.test(url)) shell.openExternal(url)
    }
  })

  // 开发时保留 Ctrl+Shift+I 打开 DevTools；打包后不暴露
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (event, input) => {
      if (input.control && input.shift && input.key.toLowerCase() === 'i') {
        win.webContents.toggleDevTools()
        event.preventDefault()
      }
    })
  }

  return win
}

// 单实例：重复启动时聚焦已有窗口，而不是开第二个（否则会有两份 localStorage 视图）
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady().then(() => {
    if (!DEV_URL && !fs.existsSync(INDEX_FILE)) {
      dialog.showErrorBox(
        '缺少前端产物',
        `找不到：\n${INDEX_FILE}\n\n请先在项目目录执行：\n    pnpm build`,
      )
      app.quit()
      return
    }

    registerAppProtocol()
    Menu.setApplicationMenu(null)
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
