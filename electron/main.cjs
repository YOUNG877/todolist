/**
 * Electron 主进程。
 *
 * 为什么用自定义的 `app://` 协议而不是 `file://`：
 * 应用的全部数据都存在 localStorage 里（见 store/persist.ts）。file:// 属于
 * opaque origin，Chromium 对它的 localStorage 支持不稳定，换版本就可能丢数据。
 * 注册一个 standard + secure 的 app:// 协议可以得到一个稳定的来源，
 * localStorage 会正常落在用户数据目录里，卸载重装应用也不会丢待办。
 *
 * 窗口模型（用户要求「关闭后不真正退出，缩成桌面右上角的悬浮小窗」）：
 *   - 主窗口：正常的应用窗口；点关闭只是隐藏，同时显示悬浮小窗
 *   - 悬浮小窗：无边框、置顶、贴屏幕右上角，只有今天的待办，可打勾
 *   - 托盘：左键切换悬浮小窗，右键菜单可打开主窗口 / 退出
 * 两个窗口加载同一个 app://local 来源，因此共用同一份 localStorage，
 * 通过 storage 事件互相同步（见 store/persist.ts 的 installStorageSync）。
 */

'use strict'

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  net,
  protocol,
  screen,
  shell,
} = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const DIST_DIR = path.join(__dirname, '..', 'dist')
const INDEX_FILE = path.join(DIST_DIR, 'index.html')
const ASSET_DIR = path.join(__dirname, 'assets')
// 开发时可以让 Electron 直接连 vite 的开发服务器：设置 ELECTRON_START_URL 即可
const DEV_URL = process.env.ELECTRON_START_URL || ''
const START_URL = DEV_URL || 'app://local/index.html'

/** 悬浮小窗尺寸与屏幕边距 */
const WIDGET_WIDTH = 320
const WIDGET_HEIGHT = 420
const WIDGET_MARGIN = 16

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
 * 不同打包配置之间很容易落到真正不同的目录，那会让用户升级后以为「待办全没了」。
 * 必须在 ready 之前调用才生效。
 */
app.setName('TodoList')

/** @type {BrowserWindow | null} */
let mainWindow = null
/** @type {BrowserWindow | null} */
let widgetWindow = null
/** @type {Tray | null} */
let tray = null
/** 标记「真的要退出」，用于区分「点关闭 = 隐藏」和「退出应用」 */
let isQuitting = false

/* -------------------------------------------------------------------------- */
/* app:// 协议                                                                 */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* 窗口                                                                        */
/* -------------------------------------------------------------------------- */

const SECURE_WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  spellcheck: false,
}

/** 页面里的外链交给系统浏览器，不在应用窗口里打开 */
function wireExternalLinks(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://')) {
      event.preventDefault()
      if (/^https?:/.test(url)) shell.openExternal(url)
    }
  })
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 380,
    minHeight: 520,
    show: false,
    backgroundColor: '#f5f6f8',
    title: '今日待办',
    autoHideMenuBar: true,
    icon: path.join(ASSET_DIR, 'icon.png'),
    webPreferences: { ...SECURE_WEB_PREFERENCES, preload: path.join(__dirname, 'preload.cjs') },
  })

  win.once('ready-to-show', () => win.show())
  win.loadURL(START_URL)
  wireExternalLinks(win)

  // 点关闭 = 隐藏到托盘，并把悬浮小窗显示出来
  win.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    win.hide()
    showWidget()
  })

  // 开发时保留 Ctrl+Shift+I；打包后不暴露
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

function createWidgetWindow() {
  const { workArea } = screen.getPrimaryDisplay()
  const win = new BrowserWindow({
    width: WIDGET_WIDTH,
    height: WIDGET_HEIGHT,
    x: workArea.x + workArea.width - WIDGET_WIDTH - WIDGET_MARGIN,
    y: workArea.y + WIDGET_MARGIN,
    show: false,
    frame: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    minWidth: 260,
    minHeight: 160,
    maxWidth: 560,
    backgroundColor: '#ffffff',
    title: '今日待办',
    icon: path.join(ASSET_DIR, 'icon.png'),
    webPreferences: { ...SECURE_WEB_PREFERENCES, preload: path.join(__dirname, 'preload.cjs') },
  })

  // floating 层级：普通置顶之上，但不会盖住系统的任务切换界面
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.loadURL(`${START_URL}${START_URL.includes('?') ? '&' : '?'}widget=1`)
  wireExternalLinks(win)

  // 小窗的关闭按钮也要走「隐藏」而不是销毁，否则下次打开要重建、状态会丢
  win.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    win.hide()
  })

  return win
}

/* -------------------------------------------------------------------------- */
/* 显示 / 隐藏                                                                 */
/* -------------------------------------------------------------------------- */

function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function showWidget() {
  if (!widgetWindow || widgetWindow.isDestroyed()) {
    widgetWindow = createWidgetWindow()
  }
  widgetWindow.showInactive() // 不抢焦点：正在主窗口里打字时不该被小窗打断
}

function hideWidget() {
  if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.hide()
}

function toggleWidget() {
  if (widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible()) hideWidget()
  else showWidget()
}

/* -------------------------------------------------------------------------- */
/* 托盘                                                                        */
/* -------------------------------------------------------------------------- */

function trayIcon() {
  for (const name of ['tray.png', 'icon.png']) {
    const p = path.join(ASSET_DIR, name)
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return img
    }
  }
  return nativeImage.createEmpty()
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '打开主窗口', click: () => showMain() },
    {
      label:
        widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible()
          ? '隐藏悬浮窗'
          : '显示悬浮窗',
      click: () => toggleWidget(),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])
}

function refreshTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu())
}

function createTray() {
  tray = new Tray(trayIcon())
  tray.setToolTip('今日待办')
  refreshTrayMenu()

  // 左键：切换悬浮小窗；双击：打开主窗口
  tray.on('click', () => {
    toggleWidget()
    refreshTrayMenu()
  })
  tray.on('double-click', () => showMain())
  // 右键时刷新标签文字（「显示/隐藏悬浮窗」）
  tray.on('right-click', () => {
    refreshTrayMenu()
    tray.popUpContextMenu()
  })
}

/* -------------------------------------------------------------------------- */
/* 生命周期                                                                    */
/* -------------------------------------------------------------------------- */

// 单实例：重复启动时聚焦已有窗口，而不是开第二个（否则会有两份 localStorage 视图）
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMain()
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

    mainWindow = createMainWindow()
    widgetWindow = createWidgetWindow()
    createTray()

    ipcMain.on('widget:hide', () => {
      hideWidget()
      refreshTrayMenu()
    })
    ipcMain.on('main:show', () => showMain())
    ipcMain.on('app:quit', () => {
      isQuitting = true
      app.quit()
    })

    app.on('activate', () => showMain())
  })

  app.on('before-quit', () => {
    isQuitting = true
  })

  // 关掉窗口不退出应用：常驻托盘，靠托盘的「退出」或小窗里的退出才真正结束
  app.on('window-all-closed', () => {
    // 这里故意什么都不做
  })
}
