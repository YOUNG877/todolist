/**
 * preload —— 只暴露悬浮小窗需要的三个动作。
 *
 * 渲染进程本身是纯静态页面，不需要任何 Node 能力，所以这里用 contextBridge
 * 暴露一个最小接口，而不是打开 nodeIntegration。
 */

'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  /** 隐藏悬浮小窗（等同于用户点了小窗右上角的 ✕） */
  hideWidget: () => ipcRenderer.send('widget:hide'),
  /** 打开主窗口并聚焦 */
  openMain: () => ipcRenderer.send('main:show'),
  /** 真正退出应用 */
  quit: () => ipcRenderer.send('app:quit'),
})
