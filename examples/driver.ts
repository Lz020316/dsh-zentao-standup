/**
 * 验证插件：不需要真实的禅道服务器，用一个 mock 禅道 API 服务器把 7 个工具
 * 走一遍真实的工具执行流水线（含 Token 认证流程）。
 * 仅用于 standalone 冒烟测试（examples/cordis.yml），不要加载进日常 DSH。
 */
import { createServer, type Server } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'

export const name = 'zentao-driver'
export const inject = ['tools']

const PORT = 18899

// ── mock 数据（deadline 用明确的过去/未来日期，保证逾期判断确定性）──
const PROJECTS = [
  { id: 1, name: '官网改版', status: 'doing', progress: 60, PM: 'zhangsan', begin: '2026-09-01', end: '2027-12-31' },
  { id: 2, name: '移动端 App', status: 'wait', progress: 0, PM: 'lisi', begin: '2026-10-01', end: '2027-12-31' },
]

const EXECUTIONS: Record<number, any[]> = {
  1: [
    { id: 11, name: '迭代一', status: 'doing', progress: 70, begin: '2026-09-01', end: '2026-09-30' },
    { id: 12, name: '迭代二', status: 'wait', progress: 0, begin: '2026-10-01', end: '2026-10-20' },
  ],
}

/** 扁平执行列表，写操作（创建/更新）维护它。 */
const ALL_EXECUTIONS: any[] = Object.values(EXECUTIONS).flat()

const USERS = [
  { account: 'zhangsan', realname: '张三' },
  { account: 'lisi', realname: '李四' },
  { account: 'wangwu', realname: '王五' },
]

const TASKS = [
  { id: 101, name: '首页视觉稿', assignedTo: 'zhangsan', status: 'doing', pri: '1', estStarted: '2026-10-08', deadline: '2027-12-31', progress: 50, estimate: 16, consumed: 8, desc: '首页视觉设计稿输出。' },
  { id: 102, name: '登录接口联调', assignedTo: 'zhangsan', status: 'wait', pri: '2', estStarted: '2026-10-10', deadline: '2027-12-31', progress: 0, estimate: 8, consumed: 0 },
  { id: 103, name: '旧版数据迁移', assignedTo: 'lisi', status: 'doing', pri: '1', estStarted: '2026-01-01', deadline: '2026-01-08', progress: 30, estimate: 24, consumed: 12, desc: '从旧库迁移用户数据，存在风险。' },
  { id: 104, name: '支付模块测试', assignedTo: 'lisi', status: 'done', pri: '2', estStarted: '2026-01-01', deadline: '2026-01-06', progress: 100, estimate: 16, consumed: 16 },
  { id: 105, name: 'App 原型设计', assignedTo: 'wangwu', status: 'wait', pri: '3', estStarted: '2026-10-12', deadline: '2027-12-31', progress: 0, estimate: 8, consumed: 0 },
  { id: 106, name: 'push 推送接入', assignedTo: 'wangwu', status: 'doing', pri: '2', estStarted: '2026-10-07', deadline: '2027-12-31', progress: 40, estimate: 12, consumed: 5 },
]

function send(res: any, status: number, body: any) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'))
      } catch {
        resolve({})
      }
    })
  })
}

const ACTION_STATUS: Record<string, string> = {
  start: 'doing',
  finish: 'done',
  close: 'closed',
  pause: 'pause',
  activate: 'doing',
  restart: 'doing',
  cancel: 'cancel',
}

function startMockServer(): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
      const path = url.pathname
      const q = url.searchParams

      // 认证：校验 token 请求头是否已携带（除了 tokens 本身）。
      if (path !== '/api.php/v1/tokens') {
        const token = req.headers.token ?? req.headers.Token
        if (!token || token !== 'mock-token-123') {
          return send(res, 401, { message: 'unauthorized: missing token' })
        }
      }

      // 1) POST /api.php/v1/tokens
      if (path === '/api.php/v1/tokens' && req.method === 'POST') {
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', () => {
          try {
            const body = JSON.parse(raw || '{}')
            if (!body.account || !body.password) return send(res, 400, { message: 'missing account/password' })
            return send(res, 201, { token: 'mock-token-123' })
          } catch {
            return send(res, 400, { message: 'bad json' })
          }
        })
        return
      }

      // 2) GET/POST /api.php/v1/projects
      if (path === '/api.php/v1/projects') {
        if (req.method === 'POST') {
          const body = await readBody(req)
          const newId = Math.max(...PROJECTS.map((p) => p.id)) + 1
          const project = { id: newId, status: 'wait', progress: 0, ...body }
          PROJECTS.push(project)
          return send(res, 201, project)
        }
        let list = PROJECTS
        const status = q.get('status')
        if (status && status !== 'all') list = list.filter((p) => p.status === status)
        return send(res, 200, { projects: list, total: list.length, limit: 100 })
      }

      // 2b) POST /api.php/v1/executions（创建执行）
      if (path === '/api.php/v1/executions' && req.method === 'POST') {
        const body = await readBody(req)
        const newId = Math.max(0, ...ALL_EXECUTIONS.map((e) => e.id)) + 1
        const execution = { id: newId, status: 'wait', progress: 0, ...body }
        ALL_EXECUTIONS.push(execution)
        if (body.project) (EXECUTIONS[body.project] ??= []).push(execution)
        return send(res, 201, execution)
      }

      // 2c) PUT /api.php/v1/execution/{id}（更新执行）
      const oneExec = path.match(/^\/api.php\/v1\/execution\/(\d+)$/)
      if (oneExec && req.method === 'PUT') {
        const id = Number(oneExec[1])
        const e = ALL_EXECUTIONS.find((x) => x.id === id)
        if (!e) return send(res, 404, { message: 'execution not found' })
        Object.assign(e, await readBody(req))
        return send(res, 200, e)
      }

      // 3) GET /api.php/v1/projects/{id}/executions
      const projExec = path.match(/^\/api.php\/v1\/projects\/(\d+)\/executions$/)
      if (projExec) {
        const id = Number(projExec[1])
        return send(res, 200, { executions: EXECUTIONS[id] ?? [], total: 0 })
      }

      // 4) GET /api.php/v1/users
      if (path === '/api.php/v1/users') {
        return send(res, 200, { users: USERS, total: USERS.length, limit: 100 })
      }

      // 5) GET/POST /api.php/v1/executions/{id}/tasks
      const execTasks = path.match(/^\/api.php\/v1\/executions\/(\d+)\/tasks$/)
      if (execTasks) {
        if (req.method === 'POST') {
          const body = await readBody(req)
          const newId = Math.max(...TASKS.map((x) => x.id)) + 1
          const task = { id: newId, progress: 0, consumed: 0, status: 'wait', ...body }
          TASKS.push(task)
          return send(res, 201, task)
        }
        return send(res, 200, { tasks: TASKS.slice(0, 3), total: 3 })
      }

      // 6) GET/PUT /api.php/v1/tasks/{id}
      const oneTask = path.match(/^\/api.php\/v1\/tasks\/(\d+)$/)
      if (oneTask) {
        const id = Number(oneTask[1])
        const t = TASKS.find((x) => x.id === id)
        if (req.method === 'PUT') {
          if (!t) return send(res, 404, { message: 'task not found' })
          Object.assign(t, await readBody(req))
          return send(res, 200, t)
        }
        return t ? send(res, 200, t) : send(res, 404, { message: 'task not found' })
      }

      // 6b) POST /api.php/v1/tasks/{id}/{action}（状态流转）
      const taskAction = path.match(/^\/api.php\/v1\/tasks\/(\d+)\/(\w+)$/)
      if (taskAction && req.method === 'POST') {
        const id = Number(taskAction[1])
        const action = taskAction[2]
        const t = TASKS.find((x) => x.id === id)
        if (!t) return send(res, 404, { message: 'task not found' })
        const status = ACTION_STATUS[action]
        if (status) t.status = status
        return send(res, 200, t)
      }

      // 7) GET /api.php/v1/tasks?search=1&assignedTo=...&status=...
      if (path === '/api.php/v1/tasks') {
        let list = TASKS
        const assignedTo = q.get('assignedTo')
        const status = q.get('status')
        const pri = q.get('pri')
        if (assignedTo) list = list.filter((t) => t.assignedTo === assignedTo)
        if (status && status !== 'all') list = list.filter((t) => t.status === status)
        if (pri) list = list.filter((t) => t.pri === pri)
        return send(res, 200, { tasks: list, total: list.length, limit: 100 })
      }

      return send(res, 404, { message: `mock: no route ${req.method} ${path}` })
    })
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })
}

function textOf(result: Awaited<ReturnType<Context['tools']['execute']>>): string {
  return result.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
}

export function apply(ctx: Context) {
  const keepAlive = setTimeout(() => {}, 60_000)

  void (async () => {
    const server = await startMockServer()
    let failed = false

    const run = async (label: string, toolName: string, args: Record<string, unknown>) => {
      console.log(`\n[driver] ── ${label} ──`)
      const result = await ctx.tools.execute({
        callId: brandString<ToolCallId>('smoke'),
        name: toolName,
        arguments: args,
        signal: new AbortController().signal,
      })
      const text = textOf(result)
      console.log(`[driver] isError = ${result.isError}`)
      console.log(`[driver] 返回 ${text.length} 字符，前 500 字：\n${text.slice(0, 500)}`)
      if (result.isError || text.length === 0) failed = true
    }

    try {
      await run('项目总览 zentao_projects', 'zentao_projects', {})
      await run('项目总览 zentao_projects（status=doing）', 'zentao_projects', { status: 'doing' })
      await run('单项目 zentao_project（id=1）', 'zentao_project', { id: 1 })
      await run('单项目 zentao_project（name=官网）', 'zentao_project', { name: '官网' })
      await run('成员 zentao_users', 'zentao_users', {})
      await run('任务 zentao_tasks（assignedTo=lisi）', 'zentao_tasks', { assignedTo: 'lisi' })
      await run('任务 zentao_tasks（status=doing）', 'zentao_tasks', { status: 'doing' })
      await run('任务 zentao_tasks（execution=11）', 'zentao_tasks', { execution: 11 })
      await run('成员任务 zentao_user_tasks（zhangsan）', 'zentao_user_tasks', { account: 'zhangsan' })
      await run('任务详情 zentao_task（id=103）', 'zentao_task', { id: 103 })
      await run('早会简报 zentao_standup', 'zentao_standup', {})

      // ── 写操作 ──
      await run('写·更新任务 zentao_task_update（补描述+改负责人）', 'zentao_task_update', {
        id: 103, desc: '从旧库迁移用户数据（补充的描述）。', assignedTo: 'zhangsan',
      })
      await run('写·改期 zentao_task_update（deadline）', 'zentao_task_update', { id: 103, deadline: '2027-01-31' })
      await run('写·状态流转 zentao_task_action（finish #104）', 'zentao_task_action', { id: 104, action: 'finish', comment: '测试完成' })
      await run('写·创建任务 zentao_task_create', 'zentao_task_create', {
        executionId: 11, name: '新增·接口压测', assignedTo: 'lisi', taskType: 'test',
        estStarted: '2026-10-13', deadline: '2026-10-20', pri: '2', estimate: 8,
      })

      // ── 项目/执行写操作 ──
      await run('写·创建项目 zentao_project_create（融合瀑布）', 'zentao_project_create', {
        name: '客户A/官网二期', begin: '2026-10-13', end: '2026-12-31', model: 'waterfallplus', PM: 'zhangsan',
      })
      await run('写·创建执行 zentao_execution_create（阶段）', 'zentao_execution_create', {
        project: 2, name: '阶段·开发', begin: '2026-10-13', end: '2026-11-13', type: 'stage',
      })
      await run('写·创建执行 zentao_execution_create（子迭代）', 'zentao_execution_create', {
        project: 2, name: '迭代1', begin: '2026-10-13', end: '2026-10-27', type: 'sprint', parent: 13,
      })
      await run('写·改期 zentao_execution_update', 'zentao_execution_update', {
        id: 12, end: '2026-11-30',
      })

      // 写后校验：新项目已建、执行已建、改期已生效。
      const projAfter = textOf(
        await ctx.tools.execute({
          callId: brandString<ToolCallId>('w3'),
          name: 'zentao_projects',
          arguments: {},
          signal: new AbortController().signal,
        }),
      )
      const okProj = projAfter.includes('客户A/官网二期')
      const execAfter = textOf(
        await ctx.tools.execute({
          callId: brandString<ToolCallId>('w4'),
          name: 'zentao_project',
          arguments: { id: 2 },
          signal: new AbortController().signal,
        }),
      )
      const okExec = execAfter.includes('阶段·开发') && execAfter.includes('迭代1')
      console.log(`\n[driver] 项目/执行写后校验：新项目已建=${okProj ? '是 ✅' : '否 ❌'}；执行已建=${okExec ? '是 ✅' : '否 ❌'}`)
      if (!okProj || !okExec) failed = true

      // 写后校验：103 已转给 zhangsan；新任务已建在 lisi 名下。
      const zhangsanTasks = textOf(
        await ctx.tools.execute({
          callId: brandString<ToolCallId>('w1'),
          name: 'zentao_tasks',
          arguments: { assignedTo: 'zhangsan' },
          signal: new AbortController().signal,
        }),
      )
      const ok103 = zhangsanTasks.includes('103')
      const lisiTasks = textOf(
        await ctx.tools.execute({
          callId: brandString<ToolCallId>('w2'),
          name: 'zentao_tasks',
          arguments: { assignedTo: 'lisi' },
          signal: new AbortController().signal,
        }),
      )
      const okNew = lisiTasks.includes('新增·接口压测')
      console.log(`\n[driver] 写后校验：103 已转给 zhangsan=${ok103 ? '是 ✅' : '否 ❌'}；新任务已建=${okNew ? '是 ✅' : '否 ❌'}`)
      if (!ok103 || !okNew) failed = true

      // 额外断言：早会简报应包含逾期任务 103。
      const standup = textOf(
        await ctx.tools.execute({
          callId: brandString<ToolCallId>('smoke-assert'),
          name: 'zentao_standup',
          arguments: {},
          signal: new AbortController().signal,
        }),
      )
      console.log(`\n[driver] 早会简报是否含逾期任务 #103：${standup.includes('103') && standup.includes('逾期') ? '是 ✅' : '否 ❌'}`)
      if (!(standup.includes('103') && standup.includes('逾期'))) failed = true
    } catch (error) {
      console.error('[driver] 失败：', (error as Error)?.message ?? error)
      failed = true
    } finally {
      server.close()
      clearTimeout(keepAlive)
    }

    console.log(`\n[driver] ${failed ? '存在失败的工具调用 ❌' : '全部通过 ✅'}`)
    if (failed) process.exitCode = 1
  })()
}
