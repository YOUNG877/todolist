/**
 * scripts/screenshot.mjs —— 用 Chrome DevTools Protocol 给页面截图并检查横向溢出
 *
 * 为什么不用 `chrome --screenshot --window-size=390`：Windows 上 Chrome 有最小窗口宽度
 * （约 470px），传更小的宽度只会把画布裁掉，布局视口并不会真的变窄，无法验证移动端。
 * 走 CDP 的 Emulation.setDeviceMetricsOverride 才能得到真实的窄视口。
 *
 * 用法：
 *   node scripts/screenshot.mjs --url "http://localhost:5180/?demo=1" --out shot.png \
 *        --width 390 --height 1400 [--dark] [--click "selector"] [--wait 1200]
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (!key.startsWith('--')) continue
    const name = key.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      out[name] = true
    } else {
      out[name] = next
      i += 1
    }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const url = args.url ?? 'http://localhost:5180/'
const out = resolve(args.out ?? '.shots/shot.png')
const width = Number(args.width ?? 1440)
const height = Number(args.height ?? 1000)
const dark = Boolean(args.dark)
const mobile = Boolean(args.mobile)
const waitMs = Number(args.wait ?? 1500)
const port = Number(args.port ?? 9333)
/**
 * 连接一个已经开好的调试端口（例如打包后的 Electron 应用用
 * `今日待办.exe --remote-debugging-port=9333` 启动），此时不再自己拉起浏览器。
 */
const attachPort = args.attach === undefined ? 0 : Number(args.attach === true ? port : args.attach)
const sizeGiven = args.width !== undefined || args.height !== undefined

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p))

if (!attachPort && !chromePath) {
  console.error('找不到 Chrome / Edge 可执行文件')
  process.exit(1)
}

const profile = `${process.env.TEMP ?? '.'}/dsh-cdp-${Date.now()}`
const chrome = attachPort
  ? null
  : spawn(
      chromePath,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-first-run',
        '--no-default-browser-check',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        ...(dark ? ['--force-dark-mode'] : []),
        'about:blank',
      ],
      { stdio: 'ignore' },
    )

/** 等待 DevTools 端口可用，并返回页面目标的 ws 地址 */
async function findPageTarget(debugPort = port) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page.webSocketDebuggerUrl
    } catch {
      /* 端口还没起来 */
    }
    await sleep(150)
  }
  throw new Error('DevTools 端口未就绪')
}

function createClient(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let nextId = 1
  const pending = new Map()
  const events = []

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve: res, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else res(msg.result)
    } else if (msg.method) {
      events.push(msg.method)
    }
  })

  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', () => res())
    ws.addEventListener('error', (e) => rej(new Error(`WS 错误: ${e.message ?? 'unknown'}`)))
  })

  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = nextId
      nextId += 1
      pending.set(id, { resolve: res, reject: rej })
      ws.send(JSON.stringify({ id, method, params }))
    })

  return { ready, send, events, close: () => ws.close() }
}

try {
  const wsUrl = await findPageTarget()
  const client = createClient(wsUrl)
  await client.ready

  await client.send('Page.enable')
  await client.send('Runtime.enable')
  // 附着到桌面应用时不改视口尺寸，保留它自己的窗口大小
  if (!attachPort && (sizeGiven || mobile)) {
    await client.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    })
  }
  if (dark) {
    await client.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'dark' }],
    })
  }

  if (!attachPort) {
    await client.send('Page.navigate', { url })
    await sleep(waitMs)
  } else {
    console.log(`已连接到调试端口 ${attachPort}，沿用当前页面：${url}`)
    await sleep(300)
  }

  if (typeof args.click === 'string') {
    // 支持多步点击：--click "选择器A;选择器B"
    for (const selector of args.click.split(';').map((s) => s.trim()).filter(Boolean)) {
      const clicked = await client.send('Runtime.evaluate', {
        expression: `(() => {
          const el = document.querySelector(${JSON.stringify(selector)})
          if (!el) return 'NOT_FOUND'
          el.click()
          return 'CLICKED'
        })()`,
        returnByValue: true,
      })
      console.log(`click ${selector}: ${clicked.result.value}`)
      await sleep(400)
    }
  }

  if (args.reload) {
    await client.send('Page.reload', { ignoreCache: true })
    await sleep(waitMs)
    console.log('page reloaded')
  }

  // --eval / --eval-file 放在所有交互之后，这样可以验证「操作 → 刷新」之后的最终状态
  const evalSource =
    typeof args['eval-file'] === 'string'
      ? readFileSync(resolve(args['eval-file']), 'utf8')
      : typeof args.eval === 'string'
        ? args.eval
        : null
  if (evalSource !== null) {
    const evaluated = await client.send('Runtime.evaluate', {
      expression: evalSource,
      returnByValue: true,
      awaitPromise: true,
    })
    if (evaluated.exceptionDetails) {
      const d = evaluated.exceptionDetails
      console.log(`eval 抛错 → ${d.exception?.description ?? d.text}`)
    } else {
      console.log(`eval → ${JSON.stringify(evaluated.result.value)}`)
    }
    await sleep(300)
  }

  const probe = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const de = document.documentElement
      const vw = de.clientWidth
      const overflowing = [...document.querySelectorAll('body *')]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && (r.right > vw + 1 || r.left < -1))
        .map(({ el, r }) => \`\${el.tagName.toLowerCase()}.\${(el.className || '').toString().split(' ')[0]} right=\${Math.round(r.right)}\`)
        .slice(0, 12)
      return JSON.stringify({
        viewport: vw,
        innerWidth: window.innerWidth,
        scrollWidth: de.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        horizontalOverflow: de.scrollWidth > vw + 1,
        overflowing,
      }, null, 2)
    })()`,
    returnByValue: true,
  })
  console.log(probe.result.value)

  const shot = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: !attachPort,
  })
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log(`已保存 ${out}`)

  client.close()
} finally {
  if (chrome) chrome.kill()
}
