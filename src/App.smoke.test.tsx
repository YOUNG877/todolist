// @vitest-environment jsdom
/**
 * App.smoke.test.tsx —— 真实 DOM 冒烟测试
 *
 * 覆盖单元测试覆盖不到的部分：组件渲染、用户点击，以及
 * 「预置 localStorage → App 启动读盘 → 结算 → 渲染」这条真实链路。
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '@/App'
import { clock } from '@/core/clock'
import { createId } from '@/core/id'
import { clearStorage, createInitialState, flushSave, STORAGE_KEY } from '@/store/persist'
import { actions, useStore, type StoreState } from '@/store/store'
import { CURRENT_VERSION, DEFAULT_SETTINGS, type PersistedState, type Task } from '@/store/types'

function at(year: number, month: number, day: number, hour = 9, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

function makeTask(partial: Partial<Task> & { title: string }): Task {
  return {
    id: createId(),
    status: 'today',
    createdAt: at(2025, 5, 31).toISOString(),
    updatedAt: at(2025, 5, 31).toISOString(),
    scheduledDate: '2025-06-01',
    completedAt: null,
    completedDate: null,
    deletedAt: null,
    priority: 'none',
    tags: [],
    dueDate: null,
    estimateMinutes: null,
    pinned: false,
    carryOverCount: 0,
    progress: 0,
    tracking: false,
    trackingProgress: 0,
    lastRolledAt: null,
    order: 1,
    parentId: null,
    recurringId: null,
    ...partial,
  }
}

function makeState(
  today: string,
  tasks: Task[] = [],
  overrides: Partial<PersistedState> = {},
): PersistedState {
  return {
    version: CURRENT_VERSION,
    tasks,
    snapshots: {},
    settings: { ...DEFAULT_SETTINGS },
    lastSettledDate: today,
    ui: { lastRolloverNotice: null, sortMode: 'manual', view: 'board', calendarMode: 'count', tagFilter: [], expandedCompletedDates: [] },
    updatedAt: at(2025, 5, 31).toISOString(),
    ...overrides,
  }
}

/** 写一份数据进 localStorage，模拟「上次用完关掉了浏览器」 */
function seedStorage(state: PersistedState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

/** 取某个面板里的任务标题（排除待办池的批量选择框）。
 *  注意 TaskItem 的标签是「完成任务：X」/「取消完成：X」，不要写成「取消完成任务：X」。 */
function titlesIn(regionName: string): string[] {
  const region = screen.getByRole('region', { name: regionName })
  return within(region)
    .queryAllByRole('checkbox')
    .map((el) => el.getAttribute('aria-label') ?? '')
    .filter((label) => label.startsWith('完成任务：') || label.startsWith('取消完成：'))
    .map((label) => label.replace(/^(?:取消完成|完成任务)：/, ''))
}

/** 切到「回顾」页 */
function openHistory(): void {
  fireEvent.click(screen.getByRole('button', { name: '回顾' }))
}

beforeEach(() => {
  clock.reset()
  clock.travelTo(at(2025, 6, 1, 9))
  // 重置 store 并把 hydrated 关掉，让下一个用例的 init() 真正去读 localStorage
  useStore.setState({
    ...createInitialState(clock.now()),
    hydrated: false,
    storageWarning: null,
    lastSettle: null,
  } as StoreState)
  // 取消上一个用例可能残留的防抖写盘，并清空存储
  clearStorage()
})

afterEach(() => {
  cleanup()
  clock.reset()
})

describe('App 真实渲染（jsdom）', () => {
  it('空数据启动：读到空状态，展示引导与示例数据按钮', () => {
    render(<App />)

    expect(screen.getByRole('region', { name: '待办池' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '今日待办' })).toBeTruthy()
    expect(screen.getByText('池子空空的，记一件想做的事吧 👇')).toBeTruthy()
    expect(screen.getByRole('button', { name: '载入示例数据' })).toBeTruthy()
  })

  it('预置 localStorage 启动后能正确读盘并渲染（M1 持久化链路）', () => {
    seedStorage(
      makeState('2025-06-01', [
        makeTask({ title: '读盘出来的任务', priority: 'high', tags: ['工作'], estimateMinutes: 30 }),
      ]),
    )

    render(<App />)

    expect(titlesIn('今日待办')).toEqual(['读盘出来的任务'])
    expect(screen.getByText('优先级 高')).toBeTruthy()
    expect(screen.getByText('#工作')).toBeTruthy()
    expect(screen.getByText('约 30 分钟')).toBeTruthy()
  })

  it('核心闭环：池中创建 → 安排到今日 → 打勾归档到「今日已完成」', () => {
    render(<App />)

    const poolInput = screen.getByLabelText('添加待办')
    fireEvent.change(poolInput, { target: { value: '写周报' } })
    fireEvent.submit(poolInput.closest('form') as HTMLFormElement)

    expect(titlesIn('待办池')).toEqual(['写周报'])
    expect(titlesIn('今日待办')).toEqual([])
    expect(titlesIn('今日已完成')).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: '→ 今日' }))

    expect(titlesIn('待办池')).toEqual([])
    expect(titlesIn('今日待办')).toEqual(['写周报'])
    expect(screen.getByText('0/1')).toBeTruthy()

    fireEvent.click(screen.getByRole('checkbox', { name: '完成任务：写周报' }))

    expect(titlesIn('今日待办')).toEqual([])
    // 今天完成的留在这一页，不去日历
    expect(titlesIn('今日已完成')).toEqual(['写周报'])
    expect(screen.getByText('今天的任务全部完成，共 1 件 🎉')).toBeTruthy()
  })

  it('历史完成记录不在今天这一页，点「查看历史回顾」才进日历页', () => {
    seedStorage(
      makeState('2025-06-01', [
        makeTask({
          title: '昨天做完的',
          status: 'done',
          completedAt: at(2025, 6, 1, 10).toISOString(),
          completedDate: '2025-06-01',
        }),
      ]),
    )
    clock.travelTo(at(2025, 6, 2, 9))
    render(<App />)

    // 「今天」页：只有今天完成的，昨天的历史记录不出现
    expect(titlesIn('今日已完成')).toEqual([])
    expect(screen.queryByText('昨天做完的')).toBeNull()
    // 日历也不在这一页
    expect(screen.queryByRole('region', { name: '已完成回顾' })).toBeNull()

    // 切到回顾页才看得到
    fireEvent.click(screen.getByRole('button', { name: '查看历史回顾 →' }))
    const history = screen.getByRole('region', { name: '已完成回顾' })
    expect(
      within(history).getByRole('gridcell', { name: /^2025-06-01 星期日，完成 1 件$/ }),
    ).toBeTruthy()
  })

  it('核心闭环：跨天后未完成任务出现在今日列表并显示顺延角标', () => {
    render(<App />)

    const input = screen.getByLabelText('添加待办')
    fireEvent.change(input, { target: { value: '拖着的任务' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    fireEvent.click(screen.getByRole('button', { name: '→ 今日' }))

    // 时间调试面板默认收起，先展开再点「+1 天」
    fireEvent.click(screen.getByRole('button', { name: /时间调试/ }))
    fireEvent.click(screen.getByRole('button', { name: '+1 天' }))

    expect(screen.getByText('顺延 1 天')).toBeTruthy()
    expect(titlesIn('今日待办')).toEqual(['拖着的任务'])
    expect(screen.getByText(/个任务没完成，已顺延到今天/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '知道了' }))
    expect(screen.queryByText(/个任务没完成，已顺延到今天/)).toBeNull()

    // 再跨两天 → 角标累加为 3 天
    fireEvent.click(screen.getByRole('button', { name: '+1 天' }))
    fireEvent.click(screen.getByRole('button', { name: '+1 天' }))
    expect(screen.getByText('顺延 3 天')).toBeTruthy()
    expect(screen.getByText('2025-06-04 星期三')).toBeTruthy()
  })

  it('回顾页日历：热力格显示件数，点某天能看到那天的完成清单', () => {
    seedStorage(
      makeState('2025-06-01', [
        makeTask({
          title: '昨天做完的',
          status: 'done',
          completedAt: at(2025, 6, 1, 10).toISOString(),
          completedDate: '2025-06-01',
        }),
      ]),
    )
    clock.travelTo(at(2025, 6, 2, 9))

    render(<App />)
    openHistory()

    const done = screen.getByRole('region', { name: '已完成回顾' })
    // 2025-06-01 是星期日；日历格显示「完成 1 件」
    const cell = within(done).getByRole('gridcell', { name: /^2025-06-01 星期日，完成 1 件$/ })
    expect(cell).toBeTruthy()
    expect(cell.className).toContain('heat-')

    // 默认选中今天，今天的清单是空的
    expect(within(done).getByRole('heading', { name: '今天' })).toBeTruthy()
    expect(within(done).getByText(/今天还没有完成的任务/)).toBeTruthy()

    // 点 06-01 → 右侧清单显示那天的任务
    fireEvent.click(cell)
    expect(within(done).getByText('昨天做完的')).toBeTruthy()
    expect(within(done).getByText(/^完成 1 件$/)).toBeTruthy()

    // 月历汇总
    expect(within(done).getByText(/本月完成/)).toBeTruthy()
  })

  it('日历可以在「件数」和「明细」之间切换，明细模式直接列出当天做了哪些事', () => {
    seedStorage(
      makeState('2025-06-01', [
        makeTask({
          title: '写周报',
          status: 'done',
          completedAt: at(2025, 6, 1, 10).toISOString(),
          completedDate: '2025-06-01',
        }),
        makeTask({
          title: '跑步 5km',
          status: 'done',
          completedAt: at(2025, 6, 1, 11).toISOString(),
          completedDate: '2025-06-01',
        }),
      ]),
    )
    clock.travelTo(at(2025, 6, 2, 9))
    render(<App />)
    openHistory()

    const done = screen.getByRole('region', { name: '已完成回顾' })
    const cell1 = within(done).getByRole('gridcell', { name: /^2025-06-01 星期日，完成 2 件$/ })

    // 默认「件数」模式：格子里只有件数，没有标题
    expect(cell1.className).not.toContain('day--detail')
    expect(within(cell1).queryByText('写周报')).toBeNull()
    expect(within(cell1).getByText('2')).toBeTruthy()

    // 切到「明细」：格子直接列出任务标题
    fireEvent.click(within(done).getByRole('button', { name: '明细' }))
    const cell2 = within(done).getByRole('gridcell', { name: /^2025-06-01 星期日，完成 2 件$/ })
    expect(cell2.className).toContain('day--detail')
    expect(within(cell2).getByText('写周报')).toBeTruthy()
    expect(within(cell2).getByText('跑步 5km')).toBeTruthy()

    // 悬停提示带上全部标题（按完成时间倒序，与右侧清单一致）
    expect(cell2.getAttribute('title')).toBe('跑步 5km、写周报')

    // 切回件数
    fireEvent.click(within(done).getByRole('button', { name: '件数' }))
    expect(
      within(done).getByRole('gridcell', { name: /^2025-06-01 星期日，完成 2 件$/ }).className,
    ).not.toContain('day--detail')
  })

  it('二级任务：点 ＋ 新增子任务，渲染在父任务下面并带自己的勾选框', () => {
    render(<App />)

    const input = screen.getByLabelText('添加待办')
    fireEvent.change(input, { target: { value: '用户权限开发' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    fireEvent.click(screen.getByRole('button', { name: '→ 今日' }))

    // 点父任务行上的「添加子任务」按钮
    fireEvent.click(screen.getByRole('button', { name: '添加子任务：用户权限开发' }))

    const subInput = screen.getByLabelText('为「用户权限开发」添加子任务')
    fireEvent.change(subInput, { target: { value: '开发进度' } })
    fireEvent.submit(subInput.closest('form') as HTMLFormElement)

    // 子任务有独立勾选框，且嵌在父任务所在的 <li> 里（缩进结构）
    const parentRow = screen
      .getByRole('checkbox', { name: '完成任务：用户权限开发' })
      .closest('li') as HTMLElement
    expect(parentRow).toBeTruthy()
    expect(
      within(parentRow).getByRole('checkbox', { name: '完成任务：开发进度' }),
    ).toBeTruthy()

    // 父任务显示子任务进度
    expect(screen.getByText('子任务 0/1')).toBeTruthy()
    // 子任务不会被当成顶层条目（子任务行不提供「移回池子」）
    expect(screen.queryAllByRole('button', { name: '移回池子' })).toHaveLength(1)
  })

  it('二级任务：勾选子任务更新进度，全部完成后父任务自动归档', () => {
    render(<App />)

    const input = screen.getByLabelText('添加今日任务')
    fireEvent.change(input, { target: { value: '用户权限开发' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)

    fireEvent.click(screen.getByRole('button', { name: '添加子任务：用户权限开发' }))
    const subInput = screen.getByLabelText('为「用户权限开发」添加子任务')

    // 输入框添加后保持打开，支持连续录入
    fireEvent.change(subInput, { target: { value: '开发进度' } })
    fireEvent.submit(subInput.closest('form') as HTMLFormElement)
    fireEvent.change(subInput, { target: { value: '接口联调' } })
    fireEvent.submit(subInput.closest('form') as HTMLFormElement)

    expect(screen.getByText('子任务 0/2')).toBeTruthy()

    fireEvent.click(screen.getByRole('checkbox', { name: '完成任务：开发进度' }))
    expect(screen.getByText('子任务 1/2')).toBeTruthy()
    // 还没全部完成，父任务仍在今日待办
    expect(titlesIn('今日待办')).toContain('用户权限开发')

    fireEvent.click(screen.getByRole('checkbox', { name: '完成任务：接口联调' }))

    // 父任务自动完成 → 归档到「今日已完成」
    expect(titlesIn('今日待办')).toEqual([])
    const done = screen.getByRole('region', { name: '今日已完成' })
    expect(within(done).getByText('用户权限开发')).toBeTruthy()
    expect(within(done).getByText('子任务 2/2')).toBeTruthy()
  })

  it('导出：从顶栏菜单打开对话框，按日期列出完成记录', () => {
    seedStorage(
      makeState('2025-06-01', [
        makeTask({
          title: '回复客户邮件',
          status: 'done',
          tags: ['工作'],
          priority: 'high',
          completedAt: at(2025, 6, 1, 10, 30).toISOString(),
          completedDate: '2025-06-01',
        }),
      ]),
    )
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '数据管理' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /导出数据/ }))

    const dialog = screen.getByRole('dialog', { name: '导出数据' })
    const preview = within(dialog).getByLabelText('导出内容预览')

    expect(preview.textContent).toContain('# 待办完成记录 · 2025 年')
    expect(preview.textContent).toContain('## 逐日完成清单')
    expect(preview.textContent).toContain('### 2025-06-01 星期日（完成 1 件）')
    expect(preview.textContent).toContain('回复客户邮件')
    expect(within(dialog).getByText(/共/)).toBeTruthy()
  })

  it('导出：可切到 CSV，带 BOM 与表头，便于 Excel 统计', () => {
    seedStorage(
      makeState('2025-06-01', [
        makeTask({
          title: '写周报',
          status: 'done',
          completedAt: at(2025, 6, 1, 9, 0).toISOString(),
          completedDate: '2025-06-01',
        }),
      ]),
    )
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '数据管理' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /导出数据/ }))

    const dialog = screen.getByRole('dialog', { name: '导出数据' })
    fireEvent.change(within(dialog).getByLabelText('格式'), { target: { value: 'csv' } })

    const preview = within(dialog).getByLabelText('导出内容预览')
    expect(preview.textContent).toContain('日期,星期,任务,层级,父任务')
    expect(preview.textContent).toContain('写周报,主任务')
    // BOM 在 <pre> 渲染时不可见，这里验证它确实存在
    expect(preview.textContent?.startsWith('\uFEFF')).toBe(true)
  })

  it('导出：回顾页也有入口，切换范围会改变统计口径', () => {
    seedStorage(
      makeState('2025-06-01', [
        makeTask({
          title: '本年完成的',
          status: 'done',
          completedAt: at(2025, 3, 10, 9, 0).toISOString(),
          completedDate: '2025-03-10',
        }),
        makeTask({
          title: '上一年完成的',
          status: 'done',
          completedAt: at(2024, 12, 20, 9, 0).toISOString(),
          completedDate: '2024-12-20',
        }),
      ]),
    )
    render(<App />)
    openHistory()

    fireEvent.click(screen.getByRole('button', { name: '导出述职数据' }))
    const dialog = screen.getByRole('dialog', { name: '导出数据' })
    const preview = within(dialog).getByLabelText('导出内容预览')

    // 默认「本年」→ 不含去年那条
    expect(preview.textContent).toContain('本年完成的')
    expect(preview.textContent).not.toContain('上一年完成的')

    // 切到自定义并把起点提前到去年，就能取到两条
    fireEvent.change(within(dialog).getByLabelText('时间范围'), { target: { value: 'custom' } })
    fireEvent.change(within(dialog).getByLabelText('起'), { target: { value: '2024-01-01' } })

    expect(within(dialog).getByLabelText('导出内容预览').textContent).toContain('上一年完成的')
  })

  it('待办池：选择框在最前、完成框在行尾，全选按钮可一次选中全部', () => {
    seedStorage(
      makeState('2025-06-01', [
        makeTask({ title: '甲', status: 'pool', scheduledDate: null }),
        makeTask({ title: '乙', status: 'pool', scheduledDate: null }),
      ]),
    )
    render(<App />)

    const pool = screen.getByRole('region', { name: '待办池' })
    const completeBox = within(pool).getByRole('checkbox', { name: '完成任务：甲' })
    const row = completeBox.closest('.task') as HTMLElement
    const selectBox = within(row).getByRole('checkbox', { name: '选中：甲' })

    // 选择框在完成框之前（DOM 顺序），也就是「移到前面」
    expect(
      selectBox.compareDocumentPosition(completeBox) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    // 全选
    fireEvent.click(within(pool).getByRole('checkbox', { name: '全选待办池任务' }))
    expect(within(pool).getByRole('button', { name: '安排选中的 2 个到今日' })).toBeTruthy()

    // 再点一次取消全选
    fireEvent.click(within(pool).getByRole('checkbox', { name: '全选待办池任务' }))
    expect(within(pool).getByRole('button', { name: '安排选中的 0 个到今日' })).toBeTruthy()
  })

  it('编辑任务：可以设置优先级与标签，标签会显示在条目上', () => {
    seedStorage(makeState('2025-06-01', [makeTask({ title: '写周报' })]))
    render(<App />)

    // 点标题进入编辑
    fireEvent.click(screen.getByRole('button', { name: '写周报' }))
    const dialog = screen.getByRole('dialog', { name: '编辑任务' })

    fireEvent.change(within(dialog).getByLabelText('优先级'), { target: { value: 'high' } })
    const tagInput = within(dialog).getByLabelText('添加标签')
    fireEvent.change(tagInput, { target: { value: '工作' } })
    fireEvent.keyDown(tagInput, { key: 'Enter' })
    fireEvent.change(tagInput, { target: { value: '重要' } })
    fireEvent.keyDown(tagInput, { key: 'Enter' })

    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))

    expect(screen.queryByRole('dialog', { name: '编辑任务' })).toBeNull()
    const today = screen.getByRole('region', { name: '今日待办' })
    expect(within(today).getByText('优先级 高')).toBeTruthy()
    expect(within(today).getByText('#工作')).toBeTruthy()
    expect(within(today).getByText('#重要')).toBeTruthy()
  })

  it('编辑任务：标题为空时拒绝保存并提示', () => {
    seedStorage(makeState('2025-06-01', [makeTask({ title: '写周报' })]))
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '写周报' }))
    const dialog = screen.getByRole('dialog', { name: '编辑任务' })
    fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: '   ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))

    expect(within(dialog).getByText('标题不能为空')).toBeTruthy()
  })

  it('标签筛选：选中标签后各面板只剩命中的任务，可一键清除', () => {
    seedStorage(
      makeState('2025-06-01', [
        makeTask({ title: '工作的事', tags: ['工作'] }),
        makeTask({ title: '学习的事', tags: ['学习'] }),
      ]),
    )
    render(<App />)

    expect(titlesIn('今日待办')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: '按标签筛选' }))
    const tagOption = screen.getByText('#工作', { selector: '.menu__check' })
    fireEvent.click(tagOption.querySelector('input') as HTMLInputElement)

    expect(titlesIn('今日待办')).toEqual(['工作的事'])
    // 顶部出现筛选提示条
    expect(screen.getByText(/正在按标签筛选/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    expect(titlesIn('今日待办')).toHaveLength(2)
  })

  it('标签管理：重命名会作用到所有任务，且不删除任务', () => {
    seedStorage(
      makeState('2025-06-01', [
        makeTask({ title: '甲', tags: ['旧名'] }),
        makeTask({ title: '乙', tags: ['旧名'] }),
      ]),
    )
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '按标签筛选' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '管理标签…' }))

    const dialog = screen.getByRole('dialog', { name: '管理标签' })
    expect(within(dialog).getByText('2 个任务')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: '重命名' }))
    const input = within(dialog).getByLabelText('重命名标签 旧名')
    fireEvent.change(input, { target: { value: '新名' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '确定' }))

    expect(within(dialog).getByText('#新名')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '完成' }))

    // 任务还在，只是标签换了
    expect(titlesIn('今日待办')).toHaveLength(2)
    expect(screen.getAllByText('#新名').length).toBeGreaterThan(0)
  })

  it('悬浮小窗模式（?widget=1）只渲染今天的待办，不渲染主界面', () => {
    window.history.replaceState({}, '', '/?widget=1')
    try {
      seedStorage(
        makeState('2025-06-01', [
          makeTask({ title: '今天的事' }),
          makeTask({ title: '池子里的事', status: 'pool', scheduledDate: null }),
        ]),
      )
      render(<App />)

      expect(screen.getByRole('checkbox', { name: '完成任务：今天的事' })).toBeTruthy()
      // 主界面独有的面板与控件不出现
      expect(screen.queryByRole('region', { name: '待办池' })).toBeNull()
      expect(screen.queryByRole('region', { name: '已完成回顾' })).toBeNull()
      expect(screen.queryByRole('button', { name: /时间调试/ })).toBeNull()
    } finally {
      window.history.replaceState({}, '', '/')
    }
  })

  it('今日待办：排序下拉里有「按截止日期」，选中后按截止日期排列', () => {
    seedStorage(
      makeState('2025-06-01', [
        makeTask({ title: '晚的', dueDate: '2025-06-20' }),
        makeTask({ title: '早的', dueDate: '2025-06-02' }),
        makeTask({ title: '没截止的' }),
      ]),
    )
    render(<App />)

    const sortSelect = screen.getByLabelText('排序方式')
    expect(within(sortSelect).getByRole('option', { name: '按截止日期' })).toBeTruthy()

    fireEvent.change(sortSelect, { target: { value: 'due' } })

    expect(titlesIn('今日待办')).toEqual(['早的', '晚的', '没截止的'])
  })

  it('悬浮小窗：底部的输入框可以新增今天的任务', () => {
    window.history.replaceState({}, '', '/?widget=1')
    try {
      seedStorage(makeState('2025-06-01', [makeTask({ title: '已有的事' })]))
      render(<App />)

      const input = screen.getByLabelText('添加今日任务（悬浮窗）')
      // 输入框在小窗底部
      expect(input.closest('.widget__foot')).toBeTruthy()

      fireEvent.change(input, { target: { value: '刚想起来的事' } })
      fireEvent.submit(input.closest('form') as HTMLFormElement)

      const tasks = useStore.getState().tasks
      const added = tasks.find((t) => t.title === '刚想起来的事')
      expect(added).toBeTruthy()
      expect(added?.status).toBe('today')
      expect(added?.scheduledDate).toBe('2025-06-01')
      // 输入框已清空，可以继续录下一条
      expect((input as HTMLInputElement).value).toBe('')
      // 新任务出现在小窗列表里
      expect(screen.getByRole('checkbox', { name: '完成任务：刚想起来的事' })).toBeTruthy()
    } finally {
      window.history.replaceState({}, '', '/')
    }
  })

  it('进度：今日待办的条目有 0–100 的滑块，拖动后数值与状态同步', () => {
    seedStorage(makeState('2025-06-01', [makeTask({ title: '写方案' })]))
    render(<App />)

    const slider = screen.getByLabelText('完成进度：写方案') as HTMLInputElement
    expect(slider.type).toBe('range')
    expect(slider.min).toBe('0')
    expect(slider.max).toBe('100')
    expect(slider.value).toBe('0')

    fireEvent.change(slider, { target: { value: '40' } })

    expect(useStore.getState().tasks.find((t) => t.title === '写方案')?.progress).toBe(40)
    // 行内数字同步更新
    const today = screen.getByRole('region', { name: '今日待办' })
    expect(within(today).getByText('40%')).toBeTruthy()
  })

  it('进度：越界值会被夹到 0–100', () => {
    seedStorage(makeState('2025-06-01', [makeTask({ title: '写方案' })]))
    render(<App />)

    const slider = screen.getByLabelText('完成进度：写方案')
    fireEvent.change(slider, { target: { value: '100' } })
    expect(useStore.getState().tasks[0].progress).toBe(100)

    // 直接调 action 传越界值
    actions.setProgress(useStore.getState().tasks[0].id, 250)
    expect(useStore.getState().tasks[0].progress).toBe(100)
    actions.setProgress(useStore.getState().tasks[0].id, -20)
    expect(useStore.getState().tasks[0].progress).toBe(0)
  })

  it('待追踪：已完成的任务可以标记追踪并单独记录追踪进度', () => {
    const doneTask = makeTask({
      title: '发布版本',
      status: 'done',
      completedAt: at(2025, 6, 1, 10, 30).toISOString(),
      completedDate: '2025-06-01',
    })
    seedStorage(makeState('2025-06-01', [doneTask]))
    render(<App />)

    const donePanel = screen.getByRole('region', { name: '今日已完成' })
    const trackBtn = within(donePanel).getByRole('button', { name: '标记为待追踪：发布版本' })
    fireEvent.click(trackBtn)

    expect(useStore.getState().tasks[0].tracking).toBe(true)
    // 出现「待追踪」角标和独立的追踪进度滑块
    expect(within(donePanel).getByText('待追踪')).toBeTruthy()
    const trackSlider = within(donePanel).getByLabelText('追踪进度：发布版本') as HTMLInputElement
    fireEvent.change(trackSlider, { target: { value: '60' } })

    expect(useStore.getState().tasks[0].trackingProgress).toBe(60)
    expect(within(donePanel).getByText('待追踪 60%')).toBeTruthy()
    // 完成进度和追踪进度是两个独立字段
    expect(useStore.getState().tasks[0].progress).toBe(0)

    // 取消追踪会清掉追踪进度
    fireEvent.click(within(donePanel).getByRole('button', { name: '取消追踪：发布版本' }))
    expect(useStore.getState().tasks[0].tracking).toBe(false)
    expect(useStore.getState().tasks[0].trackingProgress).toBe(0)
  })

  it('退回今日：已完成的任务可以一键退回今日待办', () => {
    const doneTask = makeTask({
      title: '写周报',
      status: 'done',
      completedAt: at(2025, 6, 1, 10, 0).toISOString(),
      completedDate: '2025-06-01',
    })
    seedStorage(makeState('2025-06-01', [doneTask]))
    render(<App />)

    expect(titlesIn('今日已完成')).toEqual(['写周报'])
    expect(titlesIn('今日待办')).toHaveLength(0)

    const donePanel = screen.getByRole('region', { name: '今日已完成' })
    fireEvent.click(within(donePanel).getByRole('button', { name: '退回今日待办：写周报' }))

    // 回到今日待办，完成痕迹清空
    expect(titlesIn('今日待办')).toEqual(['写周报'])
    expect(titlesIn('今日已完成')).toHaveLength(0)
    const task = useStore.getState().tasks[0]
    expect(task.status).toBe('today')
    expect(task.completedAt).toBeNull()
    expect(task.completedDate).toBeNull()
    expect(task.scheduledDate).toBe('2025-06-01')
  })

  it('退回今日：保留进度与追踪标记（只是重新打开，不是重置）', () => {
    const doneTask = makeTask({
      title: '跟进合同',
      status: 'done',
      progress: 80,
      tracking: true,
      trackingProgress: 30,
      completedAt: at(2025, 6, 1, 10, 0).toISOString(),
      completedDate: '2025-06-01',
    })
    seedStorage(makeState('2025-06-01', [doneTask]))
    render(<App />)

    const donePanel = screen.getByRole('region', { name: '今日已完成' })
    fireEvent.click(within(donePanel).getByRole('button', { name: '退回今日待办：跟进合同' }))

    const task = useStore.getState().tasks[0]
    expect(task.status).toBe('today')
    expect(task.progress).toBe(80)
    expect(task.tracking).toBe(true)
    expect(task.trackingProgress).toBe(30)
  })

  it('日历可以翻月，并能在翻走后回到今天', () => {
    seedStorage(makeState('2025-06-01'))
    render(<App />)
    openHistory()

    const done = screen.getByRole('region', { name: '已完成回顾' })
    expect(within(done).getByText('2025年6月')).toBeTruthy()

    fireEvent.click(within(done).getByRole('button', { name: '上个月' }))
    expect(within(done).getByText('2025年5月')).toBeTruthy()

    fireEvent.click(within(done).getByRole('button', { name: '下个月' }))
    fireEvent.click(within(done).getByRole('button', { name: '下个月' }))
    expect(within(done).getByText('2025年7月')).toBeTruthy()

    fireEvent.click(within(done).getByRole('button', { name: '回到今天' }))
    expect(within(done).getByText('2025年6月')).toBeTruthy()
  })
})

describe('时间旅行不应该弄丢任务', () => {
  const readPersisted = (): { lastSettledDate: string; scheduledDates: string[] } => {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) throw new Error('localStorage 里没有数据')
    const parsed = JSON.parse(raw) as { lastSettledDate: string; tasks: Array<{ scheduledDate: string | null; status: string }> }
    return {
      lastSettledDate: parsed.lastSettledDate,
      scheduledDates: parsed.tasks
        .filter((t) => t.status === 'today')
        .map((t) => t.scheduledDate ?? 'null'),
    }
  }

  it('时间旅行期间不写盘：localStorage 保持旅行前的状态', () => {
    seedStorage(makeState('2025-06-01', [makeTask({ title: '今天要做的事' })]))
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /时间调试/ }))
    fireEvent.click(screen.getByRole('button', { name: '+1 天' }))

    // 界面上确实顺延了
    expect(screen.getByText('顺延 1 天')).toBeTruthy()
    expect(titlesIn('今日待办')).toEqual(['今天要做的事'])

    flushSave()
    const persisted = readPersisted()
    expect(persisted.lastSettledDate).toBe('2025-06-01')
    expect(persisted.scheduledDates).toEqual(['2025-06-01'])
  })

  it('+1 天之后刷新页面（时钟回到真实时间），任务仍然在今日待办里', () => {
    seedStorage(makeState('2025-06-01', [makeTask({ title: '今天要做的事' })]))
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /时间调试/ }))
    fireEvent.click(screen.getByRole('button', { name: '+1 天' }))
    expect(titlesIn('今日待办')).toEqual(['今天要做的事'])

    // 模拟刷新：卸载组件 → 把 store 重置回初始状态（真实刷新会重置整个模块状态）
    // → 时钟回到真实时间 → 重新挂载并从 localStorage 读盘
    cleanup()
    useStore.setState({
      ...createInitialState(clock.now()),
      hydrated: false,
      storageWarning: null,
      lastSettle: null,
    } as StoreState)
    clock.travelDays(-1)
    render(<App />)

    expect(titlesIn('今日待办')).toEqual(['今天要做的事'])
    expect(screen.queryByText('顺延 1 天')).toBeNull()
  })

  it('「时间归零」会恢复旅行前的状态，而不是把任务留在明天', () => {
    seedStorage(makeState('2025-06-01', [makeTask({ title: '今天要做的事' })]))
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /时间调试/ }))
    fireEvent.click(screen.getByRole('button', { name: '+1 天' }))
    expect(titlesIn('今日待办')).toEqual(['今天要做的事'])

    fireEvent.click(screen.getByRole('button', { name: '时间归零' }))

    expect(titlesIn('今日待办')).toEqual(['今天要做的事'])
    expect(screen.queryByText('顺延 1 天')).toBeNull()
  })

  it('回拨时钟时，逾期的今日任务不会掉进「两个列表都不显示」的空隙', () => {
    // 任务被排在 2025-05-30，但 lastSettledDate 已经是 06-01（异常/回拨状态）
    seedStorage(
      makeState(
        '2025-06-01',
        [makeTask({ title: '被落下的任务', scheduledDate: '2025-05-30' })],
        { lastSettledDate: '2025-06-05' },
      ),
    )
    render(<App />)

    // 时钟回拨后 today 仍是真实今天，任务必须出现在某个列表里，不能凭空消失
    const inToday = titlesIn('今日待办')
    const inPool = titlesIn('待办池')
    expect([...inToday, ...inPool]).toContain('被落下的任务')
  })
})
