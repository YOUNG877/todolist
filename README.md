# 今日待办 · TodoList

以「今天」为中心的待办事项网站：长期任务放在**待办池**，每天挑几件拖进**今日待办**，
做完打勾归档到当天，没做完的第二天**自动顺延**并显示「顺延 N 天」角标。

> 需求依据：`待办事项网站-需求文档.md`（同目录）。本 README 只记录实现状态、运行方式与偏差。

---

## 当前进度

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| M0 | Vite + React 18 + TS 脚手架、目录结构、CSS 变量与主题、布局骨架 | ✅ 完成 |
| M1 | 数据模型、`clock`/`date`、Zustand store、localStorage 持久化（防抖 + 备份 + 迁移 + 降级） | ✅ 完成 |
| M2 | `settle()` 结算与顺延算法、`order` 排序权重、单元测试、调试面板（+1/+7 天） | ✅ 完成 |
| M3 | 主闭环 UI（创建 / 池 / 安排 / 今日 / 完成归档 / 自动顺延 / 取消完成） | ✅ 完成 |
| M4 | **已完成日历视图（FR-16）**、统计卡片、UI 整体重做、深浅色与响应式 | ✅ 完成 |
| M5 | **拆成「今天 / 回顾」两页**、日历「件数 / 明细」双模式、修复时间旅行丢任务 | ✅ 完成 |
| M6 | **二级任务（FR-13）**：缩进子任务、父子级联完成、跟随父任务顺延 | ✅ 完成 |
| M7 | **桌面应用与 Windows 安装包**：Electron 主进程、`app://` 协议、图标、NSIS 安装包 | ✅ 完成 |
| M8 | **导出述职数据**：按日期逐日导出 + 月度/标签统计，Markdown / CSV 两种格式 | ✅ 完成 |
| M9 | 拖拽排序、编辑弹窗、行内语法、Toast 撤销、自动更新、PWA | ⬜ 未开始 |

**已验证**：`pnpm typecheck` 无错误 · `pnpm test` **63/63 通过** · `pnpm build` 成功 ·
1560px / 390px 视口下均无横向溢出 · 安装包 `release/TodoList-0.2.0-setup.exe`。

测试构成：

- `src/core/settle.test.ts`（14 条）—— 需求文档 8.4 要求的 10 类用例
- `src/store/flow.test.ts`（15 条）—— 需求 11.2 跨天脚本自动化版 + 10 条二级任务用例
- `src/core/exporter.test.ts`（17 条）—— 导出：范围过滤、子任务归属、统计自洽、Markdown/CSV 结构
- `src/App.smoke.test.tsx`（17 条，**jsdom 真实 DOM**）—— 渲染、点击、日历、二级任务、导出对话框，
  以及 4 条盯住「时间旅行会不会弄丢任务」的回归测试

---

## 快速开始

需要 Node ≥ 18（本机验证于 Node v24.21.0 / pnpm 11.7.0）。

```bash
pnpm install       # 首次安装
pnpm dev           # 开发服务器，默认 http://localhost:5173
pnpm test          # 跑单元测试（43 条）
pnpm typecheck     # TypeScript 严格模式检查
pnpm build         # 产物输出到 dist/（base 为相对路径，可直接双击打开）
pnpm preview       # 预览构建产物
pnpm app           # 构建后直接以桌面应用方式运行（Electron）
pnpm app:pack      # 生成 Windows 安装包到 release/
```

### 桌面应用与安装包

```bash
pnpm app:pack      # → release/TodoList-0.1.0-setup.exe（NSIS 安装包，约 106MB）
pnpm app           # 不打包，直接跑桌面应用，便于调试主进程
```

安装包特性：可选安装目录、创建桌面与开始菜单快捷方式（名称「今日待办」）、
**卸载时不删除数据**（`deleteAppDataOnUninstall: false`，待办记录会保留）。

几个实现要点：

- **用自定义 `app://` 协议加载页面，而不是 `file://`**。应用全部数据都存在 localStorage 里，
  而 `file://` 属于 opaque origin，Chromium 对它的 localStorage 支持不稳定，换版本就可能丢数据。
  `app://` 是 standard + secure 协议，来源稳定。已实测：打包后应用内写入数据 → 刷新 → **完整退出再重启**，
  数据完好（`origin` 为 `app://local`）。
- **固定用户数据目录名**：主进程在 ready 之前调用 `app.setName('TodoList')`。
  默认规则会取 `package.json` 的 `name`（开发运行 → `todolist`）或 `productName`（打包运行 → `今日待办`），
  两者是**真正不同的目录**，调完主进程再打开应用就会以为「待办全没了」。固定名字可以避免这种分裂。
  待办数据实际存放于 **`%APPDATA%\TodoList\Local Storage`**（Windows 该卷大小写不敏感，
  `todolist` 与 `TodoList` 指向同一个目录，所以改名不会丢已有数据）。
  另外已实测：数据在应用**优雅退出时落盘**，硬杀进程可能丢失最近的改动。
- 主进程关掉了 `nodeIntegration`，开启 `contextIsolation` 与 `sandbox`——页面是纯静态内容，
  不需要任何 Node 能力。
- 单实例锁：重复启动会聚焦已有窗口，避免两个进程同时读写同一份 localStorage。
- 图标由 `scripts/make-icon.py` 用 Pillow 生成（`pnpm icon`），改配色只需改脚本里的常量。
- 页面里的外链交给系统浏览器打开；打包后不暴露 DevTools 快捷键。

#### 本机打包遇到的两个坑

> **1. Electron 运行时缺失。** pnpm 执行 electron 的 postinstall 时可能静默失败
> （`node_modules/electron/dist` 不存在，但安装过程不报错）。修复：
> ```bash
> node node_modules/electron/install.js
> ```
> 另外 Electron 二进制默认从 GitHub Releases 下载，国内网络极慢或直接失败，
> 仓库里的 `.npmrc` 已把它指向 npmmirror 镜像。
>
> **2. `EPERM: rename 'release\win-unpacked.tmp' -> 'release\win-unpacked'`。**
> electron-builder 解压 Electron 后要把临时目录改名成最终目录，而工作区内有文件监视/杀软
> 正在扫描刚写入的上百个二进制文件，句柄未释放就会让目录改名失败——它**每次都在同一位置失败**。
> 实测：同一个操作在工作区外完全正常。绕过办法是把输出目录指到工作区外再拷回来：
> ```bash
> pnpm exec electron-builder --win --x64 "-c.directories.output=C:/Users/you/TodoList-release"
> cp C:/Users/you/TodoList-release/TodoList-*-setup.exe release/
> ```
>
> **3. 打包后的应用秒退、报 `bad option: --remote-debugging-port`。**
> 这是环境变量 `ELECTRON_RUN_AS_NODE=1` 造成的——它会让 Electron 退化成纯 Node 运行。
> 启动前清掉即可：`$env:ELECTRON_RUN_AS_NODE = $null`。不是应用本身的问题。

#### 验证打包后的应用

`scripts/screenshot.mjs` 支持附着到已经开好的调试端口，可以给真实桌面应用截图、
执行任意 JS、验证数据持久化：

```bash
# 以调试端口启动打包后的应用（先清掉 ELECTRON_RUN_AS_NODE）
"release/win-unpacked/今日待办.exe" --remote-debugging-port=9333

# 附着上去：截图 + 读 localStorage + 刷新后复查
node scripts/screenshot.mjs --attach 9333 --out .shots/app.png --eval-file probe.js
node scripts/screenshot.mjs --attach 9333 --out .shots/app2.png --reload --eval-file probe.js
```

### 演示模式

访问 `http://localhost:5173/?demo=1`：若当前没有任何任务，会自动载入示例任务
再加 3 周的历史完成记录，方便立刻看到日历热力、连续打卡、完成率这些**需要历史数据才看得出来**的部分。
只在空数据时生效，不会覆盖你已有的数据。

### 截图 / 响应式检查脚本

```bash
node scripts/screenshot.mjs --url "http://localhost:5180/?demo=1" --out .shots/desktop.png --width 1560 --height 1100
node scripts/screenshot.mjs --url "http://localhost:5180/?demo=1" --out .shots/mobile.png --width 390 --height 1500 --mobile
# 多步点击（分号分隔）+ 刷新后截图：用来验证「时间旅行后刷新会不会丢任务」
node scripts/screenshot.mjs --url "http://localhost:5180/?demo=1" --out .shots/after.png \
     --click ".topbar__actions .btn;.debug__row .btn--primary" --reload
```

脚本走 Chrome DevTools Protocol，会**顺便报告页面是否存在横向溢出**（列出溢出的元素）。
为什么不用 `chrome --screenshot --window-size=390`：Windows 上 Chrome 有约 470px 的最小窗口宽度，
传更小的值只会把画布裁掉、布局视口并不会变窄，看起来像是溢出，其实是假象。

> **pnpm 11 注意**：`onlyBuiltDependencies` 之类的设置已从 `package.json` 迁移到 `pnpm-workspace.yaml`。
> 本仓库已经用 `allowBuilds: { esbuild: true }` 放行 esbuild 的安装脚本，否则 vite / vitest 无法运行。
> 若 install 报 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`，加 `$env:CI='true'`（Windows）或 `CI=true` 再试。

---

## 目录结构

```
src/
├── main.tsx / App.tsx          应用入口、结算触发时机、主题应用
├── core/                       业务规则（纯逻辑，可单测）
│   ├── clock.ts                ★ 全局唯一时间源，支持时间旅行
│   ├── date.ts                 ★ 逻辑日期 / 日界 / 日历日加减
│   ├── settle.ts               ★ 结算与顺延（核心算法）
│   ├── order.ts                排序权重：中值插入 + 精度耗尽重排
│   ├── selectors.ts            派生数据：今日/池/完成分组/统计
│   ├── id.ts                   id 生成
│   └── settle.test.ts          ★ 需求 8.4 要求的 14 条用例（node 环境）
├── store/
│   ├── types.ts                ★ 数据契约（Task / DaySnapshot / Settings / AppState）
│   ├── persist.ts              localStorage 读写、结构校验、版本迁移、防抖、备份、内存降级
│   ├── store.ts                Zustand + Immer，全部写操作（actions）
│   └── flow.test.ts            ★ 需求 11.2 跨天脚本的自动化版本（node 环境）
├── components/                 TopBar / QuickAdd / TaskItem / TaskNode / BacklogPanel / TodayPanel
│                              TodayDonePanel / HistoryView / CompletedCalendar / RolloverNotice / DebugPanel
├── App.smoke.test.tsx          ★ 真实 DOM 冒烟测试（jsdom 环境，文件顶部用 docblock 指定）
└── styles/                     tokens.css（设计令牌）、themes.css（亮暗色板）、global.css（重置 + 全部组件样式）
scripts/
└── screenshot.mjs              CDP 截图 + 横向溢出检查 + 多步点击 / 刷新
```

> 测试环境：默认 `node`；`App.smoke.test.tsx` 顶部有 `// @vitest-environment jsdom`，
> 只有它跑在 jsdom 里，算法测试不需要 DOM 开销。

---

## 核心算法：逻辑日期与顺延

### 1. 逻辑日期（`core/date.ts`）

日界默认 **凌晨 04:00**：凌晨 0–4 点提交或完成的任务仍然算作**前一天**。

```ts
logicalDateOf(new Date(2025, 5, 11, 2, 0), 4)  // → '2025-06-10'
logicalDateOf(new Date(2025, 5, 11, 9, 0), 4)  // → '2025-06-11'
```

> ⚠️ 全项目**禁止** `new Date()` 与 `toISOString().slice(0,10)`：
> 后者按 UTC 取日期，东八区用户在早上 8 点前会拿到「昨天」。日期一律走 `formatLocalDate`。

### 2. 结算与顺延（`core/settle.ts`）

触发时机：**应用启动 + 窗口重获焦点 + 每分钟心跳**，三者调用同一个幂等的 `settle()`。

- 同一天重复调用 → 直接返回，不产生任何副作用（幂等）
- 跨 N 天 → **逐日推演** N 次，每一天都写入 `DaySnapshot`
- 撤销 / 退回池中：`rolloverStrategy = 'pinned-only'` 或 `carryOverCount > rolloverMaxDays`
- `rolloverStrategy = 'ask'` 时不动数据，只回报 `pendingAskIds` 等用户决定
- 顺带清理回收站中超过 30 天的任务
- 系统时间被回拨（`lastSettledDate > today`）时不回滚数据、不推进游标

### 3. 状态机

| 当前 | 事件 | 结果 | 副作用 |
| --- | --- | --- | --- |
| pool | 安排到今日 | today | `scheduledDate = 今天`，order 追加末尾 |
| today | 勾选完成 | done | `completedAt = now`，`completedDate = 逻辑日期` |
| today | 跨天未完成 | today | `scheduledDate = 今天`，`carryOverCount += 跨越天数` |
| today | 跨天且超限/非必做 | pool | `scheduledDate = null` |
| done | 取消完成（含历史） | today | 回到今天，`carryOverCount` **不变** |
| 任意 | 删除 | trash | `deletedAt = now`，记 `prevStatus` |
| trash | 超过 30 天 | 物理删除 | 由 `settle()` 清理 |

---

## 二级任务（FR-13）

父任务行右侧有一个 **＋** 按钮，点开后在下方出现输入框，回车即加为二级任务
（输入框保持打开，方便连续录入；`Esc` 收起）。

```
☐ 写周报                     子任务 0/2      ↑ ↓ ＋ 移回池子 ✕
  ├─ ☐ 汇总本周进度                                       ✕
  └─ ☐ 整理下周计划                                       ✕
```

规则（都在 `core/settle.ts` / `store/store.ts` 里，有单测守着）：

| 场景 | 行为 |
| --- | --- |
| 子任务的归属 | `parentId` 指向父任务；**不进入顶层列表**，也不单独计入今日完成率与日历 |
| 子任务的安排 | 跟随父任务：父任务进今日 / 回池子 / 顺延，子任务一起走 |
| **顺延** | **子任务不独立顺延**，跨天时只同步 `scheduledDate`，自己的 `carryOverCount` 保持 0 |
| 勾选父任务 | 连带完成所有子任务 |
| 子任务全部完成 | 若 `settings.autoCompleteParent` 开启，父任务自动完成（只在「子任务被勾选」这个事件里触发，所以手动取消父任务后不会被立刻重新勾上） |
| 取消某个子任务 | 父任务同步恢复成未完成 |
| 给已完成的父任务加子任务 | 父任务恢复成未完成（它其实还没做完） |
| 删除 / 恢复 / 彻底删除父任务 | 级联到子任务，避免留下孤儿 |
| 顺延提示计数 | 跨 3 天仍然只算 **1 个**任务，而不是 3 个 |

---

## 界面结构：两页 + 两种日历显示

顶栏的「今天 / 回顾」切换两个主视图：

| 视图 | 内容 | 用途 |
| --- | --- | --- |
| **今天** | 待办池 \| 今日待办 \| 今日已完成（三栏） | 干活的地方。**只有今天完成的**会出现在这里 |
| **回顾** | 月历 + 选中日清单 + 4 张统计卡 + 回收站 | 看历史的地方。历史完成记录只在这里出现，两处不重复 |

日历格子支持两种显示方式，在日历标题栏右侧切换：

- **件数**（默认）：紧凑方格，只显示当天完成件数，背景深浅表示完成率热力
- **明细**：格子变高，直接列出当天做了哪些事（最多 3 条，超出显示 `+N`），
  同时右上角保留件数；鼠标悬停还会用 `title` 提示全部标题

点任意一天 → 右侧显示那天的完成清单（可取消完成、删除）。月份可翻，也有「回到今天」。

---

## 导出述职数据

入口有两个：顶栏 `⋯` 菜单 → 「导出数据」，或「回顾」页右上角的「导出述职数据」。
弹窗里可以选时间范围（本年 / 本月 / 最近 30 天 / 自定义）、格式，以及是否附上未完成任务与备注，
**右侧实时预览最终内容**。

导出的 Markdown 长这样（真实输出，非示意）：

```markdown
# 待办完成记录 · 2026 年

> 统计范围：2026-01-01 ~ 2026-10-13　·　导出时间：2026-10-13 20:56

## 总览

| 指标 | 数值 |
| --- | --- |
| 累计完成 | **32** 件 |
| 有记录天数 | 17 天 |
| 活跃月份 | 2 个 |
| 平均每天完成 | 1.9 件 |
| 最长连续完成 | 4 天 |

## 按月分布

| 月份 | 完成件数 | 有记录天数 |
| --- | ---: | ---: |
| 2026-01 | 0 | 0 |
...
| 2026-09 | 13 | 7 |
| 2026-10 | 19 | 10 |

## 按标签分布
## 按优先级分布

## 逐日完成清单

### 2026-10-13 星期二（完成 1 件）

- [x] 回复客户邮件 `P:高 #工作` — 10:30

### 2026-10-11 星期日（完成 2 件）

- [x] 读《重构》30 页 — 09:15
- [x] 代码评审 — 10:15
```

设计要点：

- **按月分布保留 0 件的月份**，这样月度趋势是连续的，能看出「哪几个月产出下滑」。
- **子任务嵌套在父任务下**，且不单独计数——否则「写周报 + 2 个子步骤」会被算成 3 件，
  统计口径会虚高。
- **CSV 带 UTF-8 BOM**。没有 BOM 的话 Excel 打开中文是乱码，这是最常见的导出坑。
- **标记 `[x]` 的复选框**可以直接粘进支持 Markdown 的文档工具，也可以当纯文本清单用。
- 已被**彻底删除**的任务无法还原标题，不会出现在导出里（弹窗底部有说明）。

---

## 如何验证跨天顺延（无需改系统时间）

点顶栏的 **🐞 时间调试** 展开面板（默认收起，避免平时干扰）：

1. 创建几个任务，把其中几个「→ 今日」。
2. 勾选完成 1 个 → 它会归档到「已完成 · 今天」。
3. 点 **+1 天** → 未完成的自动出现在新的今日列表，并显示「顺延 1 天」角标；
   展开调试面板的「详情」可以看到每一天的快照（计划 / 完成 / 顺延出 / 退回池 / 完成率）。
4. 点 **+7 天** → 角标变为「顺延 8 天」，中间 8 天每天都有快照。
5. 在详情里把「顺延策略」切成「仅必做任务顺延」或把「顺延上限」设为 2，再点 +1 天，
   观察任务被退回待办池。

时间内旅行只存在于内存，刷新页面即恢复真实时间。

### ⚠️ 时间旅行的持久化约定（曾经在这里丢过任务）

**时间旅行期间不写 localStorage。** 这一条是硬性约束，原因是一个真实踩过的坑：

> 曾经 `saveState` 没有这道闸门，于是「+1 天」把 `lastSettledDate` 和任务的 `scheduledDate`
> 都推进到 D+1 并写进了磁盘。用户一刷新页面，时钟回到真实时间，「今天」退回 D，
> 而任务躺在 D+1 成了未来排期 —— **今日待办里的任务全都"不见了"**。

配套行为：

| 操作 | 结果 |
| --- | --- |
| 时间旅行中改数据（打勾、新增…） | 只改内存，不落盘 |
| 刷新页面 | 回到真实的今天 + 磁盘上旅行前的数据，任务不会跑到「明天」 |
| 点「时间归零」 | 时钟复位，并从 localStorage 恢复回旅行前的状态（旅行中的改动会丢弃） |
| 系统时间被回拨（非调试） | 不回滚数据，但仍会补漏：把已逾期的今日任务拉到今天，避免它同时不属于任何列表而"消失" |

`src/App.smoke.test.tsx` 里有 4 条回归测试专门盯这些场景。

---

## 与需求文档的偏差（有意为之，均已记录）

| # | 文档写法 | 实际实现 | 原因 |
| --- | --- | --- | --- |
| 1 | 使用 `zustand/persist` 中间件 | 自研 `store/persist.ts`，由 `subscribe` + `updatedAt` 闸门驱动 | 需要「写前备份」「版本迁移链」「配额满降级内存」三件事，自研更可控；且纯 UI 状态变化不写盘 |
| 2 | `settle()` 返回 `Task[]` | 返回 `RolledInfo[]`（id / title / carryOverCount / from / to） | immer draft 在 `produce` 结束后失效，返回 draft 引用会导致难以排查的 bug |
| 3 | 8.4 的 10 条用例集中在 `settle.test.ts` | 同文件共 14 条（含 store 行为与 `order` 用例） | 便于一次跑完；`describe` 已标注用例编号 |
| 4 | 伪代码仅在游标变化时处理顺延 | 额外增加 `sweepStale()` 补漏 | 导入数据或异常状态下，`lastSettledDate === today` 但仍有落后任务，需要兜底 |
| 5 | `DaySnapshot.planned` 定义模糊 | 「当天排在今日列表上的任务数」= `completedDate == date` ∪ 顺延出 ∪ 退回池 ∪ `scheduledDate == date` | 逐日推演时被顺延的任务 `scheduledDate` 已改到次日，必须显式并集才不会漏计 |
| 6 | FR-03 提到「未来某天」的任务，但未定义展示位置 | 待办池面板底部单列「已排期（未来 N）」分组 | 否则提前排期的任务在两个面板里都看不见 |
| 7 | FR-01 行内语法（`!高` `#标签` `@日期` `~30m`） | 未实现，输入框只收标题 | 排在 M4 |
| 8 | 测试中比较 `completedAt` / `lastRolledAt` | 只比到**分钟**（`slice(0, 16)`） | `clock.now()` 是活时钟：`travelTo` 之后时间仍在流动，毫秒级断言会偶发失败 |
| 9 | FR-16「已完成按月历展示」原本只写了「点击某天看清单」 | 已完成的**主视图**换成月历，展开式日期分组列表取消 | 用户明确要求用日历表达；分组列表与月历信息重复 |
| 10 | 调试面板常驻在页面顶部 | 收进顶栏按钮，默认收起 | 常驻的调试条显著拉低了主界面的观感 |
| 11 | — | 新增 `?demo=1` 演示模式 | 日历热力、连续打卡这些必须有历史数据才看得出效果，空数据下无法自检也无法演示 |
| 12 | FR-16 把日历放在「已完成」面板里 | 拆成「今天 / 回顾」两个视图；今天完成的留在主页面，历史记录只在回顾页 | 用户明确要求两页分开 |
| 13 | — | 日历增加「件数 / 明细」双模式 | 用户要求「每天完成的任务在日历表里可以详细显示，也可以显示完成件数」 |
| 14 | 时间旅行只写在文档注释里 | 真正实现为「旅行期间不落盘 + 归零时从磁盘恢复」 | 否则刷新页面会让任务跑到"明天"而看起来全部消失（见上文「时间旅行的持久化约定」） |
| 15 | 待办池行内提供 ↑↓ 排序按钮 | 去掉，只在「今日待办」提供 | 三栏布局下待办池列较窄，两个图标会把标题挤成三行；手动排序对池子意义不大 |
| 16 | FR-13 只说「父任务显示 2/5 进度」 | 进度做成 `子任务 0/2` 的 chip，并实现「父完成任务连带子任务 / 子任务全完成自动完成父任务 / 加子任务会复活已完成的父任务」 | 只有进度条的话，父子完成状态会互相矛盾 |
| 17 | FR-13「子任务不参与跨天顺延，跟随父任务」 | 在 `settle` 里 `isOpenTodayTask` 要求 `!parentId`，并新增 `syncChildrenPlacement()` 同步安排 | 否则子任务会被当成独立任务累加顺延次数，还会污染顺延提示的件数 |
| 18 | — | 修复级联恢复失效：`restoreTask` / `purgeTask` 改用 `allChildrenOf`（含已删除子任务） | 恢复时子任务自己就带着 `deletedAt`，用「只看未删除」的 `childrenOf` 会一个都匹配不到，级联静默失效 |
| 19 | — | 修复顺延提示计数虚高：`result.rolled` 按任务 id 去重 | 逐日推演时同一任务每天都会被推一次，跨 3 天会报成「有 3 个任务没完成」 |

---

## 开发约定

- **提交节奏**：每完成一个可验证的功能节点就提交并推送到 `origin/main`。
  节点的验收标准是「`pnpm typecheck` 干净 + `pnpm test` 全绿 + `pnpm build` 通过」。
  不攒一大批改动一起提交，也不为一个错别字单开一次提交。
- **提交信息**：`<类型>: <做了什么>`，正文写「为什么」而不是「改了什么」——代码本身已经说明了改了什么。
  类型用 `feat` / `fix` / `refactor` / `docs` / `test` / `chore`。
- **不提交**：`node_modules`、`dist`、`release`、`.pnpm-store`、`.shots`、IDE 配置（见 `.gitignore`）。
- **每次改动都要跑**：`pnpm typecheck && pnpm test`；动过构建配置或 Electron 主进程再跑 `pnpm build`。

## 已知待办（M8）

- 拖拽排序（当前用 ↑ / ↓ 按钮）、`Alt + ↑/↓` 快捷键
- 任务编辑弹窗（备注、截止日期、标签、预计耗时的可视化编辑；数据层字段已就绪）
- 行内语法解析（`!高` `#标签` `@日期` `~30m`）、`Ctrl/Cmd + K` 命令面板
- Toast 撤销（当前删除 / 批量安排 / 清空无撤销，只有二次确认）
- 日历点某天时的「当时安排了什么 / 顺延出去什么」明细（`DaySnapshot` 里已有 `planned` / `carriedOutIds`）
- 桌面通知、PWA、任务数超过 200 时的虚拟滚动
