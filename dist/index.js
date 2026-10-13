// src/index.ts
import { defineTool } from "@deepseek-ai/dsh-tools";
import Schema from "@deepseek-ai/schemastery";
var name = "zentao-standup";
var inject = ["systemPrompt", "tools"];
var Config = Schema.object({
  baseUrl: Schema.string().required(),
  account: Schema.string().required(),
  password: Schema.string().required(),
  timeoutMs: Schema.number().default(15e3),
  limit: Schema.number().default(100),
  persona: Schema.boolean().default(false)
});
var TASK_STATUS = {
  wait: "待开始",
  doing: "进行中",
  done: "已完成",
  pause: "已暂停",
  cancel: "已取消",
  closed: "已关闭"
};
var PROJECT_STATUS = {
  wait: "未开始",
  doing: "进行中",
  suspended: "已挂起",
  closed: "已关闭",
  done: "已结束"
};
var EXECUTION_STATUS = {
  wait: "未开始",
  doing: "进行中",
  suspended: "已挂起",
  closed: "已关闭",
  done: "已结束"
};
var PRI_LABEL = {
  "1": "紧急",
  "2": "高",
  "3": "中",
  "4": "低"
};
var DONE_STATUS = /* @__PURE__ */ new Set(["done", "closed", "cancel"]);
function statusOf(map, raw) {
  if (raw == null) return "-";
  const s = String(raw);
  return map[s] ?? s;
}
function priOf(raw) {
  if (raw == null) return "-";
  const s = String(raw);
  return `${PRI_LABEL[s] ?? s}(${s})`;
}
function day(raw) {
  if (raw == null || raw === "" || raw === "0000-00-00") return "-";
  return String(raw).slice(0, 10);
}
function isOverdue(task, today) {
  if (!task || !task.deadline) return false;
  if (DONE_STATUS.has(String(task.status ?? ""))) return false;
  const deadline = String(task.deadline).slice(0, 10);
  return deadline !== "0000-00-00" && deadline < today;
}
var ZentaoClient = class {
  constructor(config) {
    this.config = config;
  }
  token = null;
  get base() {
    return this.config.baseUrl.replace(/\/+$/, "");
  }
  url(path, query) {
    const q = new URLSearchParams();
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== void 0 && v !== "") q.set(k, String(v));
      }
    }
    const qs = q.toString();
    return `${this.base}/api.php/v1/${path.replace(/^\/+/, "")}${qs ? `?${qs}` : ""}`;
  }
  async json(res) {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { raw: text };
    }
  }
  async auth() {
    let res;
    try {
      res = await fetch(this.url("tokens"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: this.config.account, password: this.config.password }),
        signal: AbortSignal.timeout(this.config.timeoutMs)
      });
    } catch (error) {
      throw new Error(`无法连接禅道服务器 ${this.base}：${error.message}`);
    }
    const body = await this.json(res);
    if (!res.ok || !body?.token) {
      throw new Error(
        `禅道认证失败（HTTP ${res.status}）：${body?.message || body?.error || "账号或密码错误，或服务器未开启 REST API"}`
      );
    }
    this.token = body.token;
  }
  async request(path, init = {}, query) {
    const doFetch = async () => {
      const res2 = await fetch(this.url(path, query), {
        ...init,
        signal: AbortSignal.timeout(this.config.timeoutMs),
        headers: {
          ...init.headers ?? {},
          // ZenTao 用 Token 请求头还原会话（只发一个，避免大小写重复头被合并）。
          ...this.token ? { Token: this.token } : {}
        }
      });
      return { res: res2, body: await this.json(res2) };
    };
    let { res, body } = await doFetch();
    if (res.status === 401 || res.status === 400 && body?.message && /token|session|login|auth/i.test(String(body.message))) {
      await this.auth();
      ({ res, body } = await doFetch());
    }
    if (!res.ok) {
      const msg = body?.message || body?.error || res.statusText || `HTTP ${res.status}`;
      throw new Error(`禅道 API 错误（HTTP ${res.status}）：${msg}`);
    }
    return body;
  }
  // ── 业务方法 ──
  async projects(status) {
    const data = await this.request("projects", {}, {
      status: status || "all",
      limit: Math.max(this.config.limit, 100)
    });
    return data?.projects ?? [];
  }
  async executions(projectId) {
    const data = await this.request(`projects/${projectId}/executions`, {}, {
      status: "undone",
      limit: Math.max(this.config.limit, 100)
    });
    return data?.executions ?? [];
  }
  async users() {
    const data = await this.request("users", {}, { limit: Math.max(this.config.limit, 100) });
    return data?.users ?? [];
  }
  /** 按人/状态/优先级搜索任务（search 模式）。 */
  async tasksBySearch(filter) {
    const data = await this.request("tasks", {}, {
      search: 1,
      assignedTo: filter.assignedTo,
      status: filter.status,
      pri: filter.pri,
      limit: Math.max(this.config.limit, 100)
    });
    return data?.tasks ?? [];
  }
  async tasksByExecution(executionId, status) {
    const data = await this.request(`executions/${executionId}/tasks`, {}, {
      status: status || "all",
      limit: Math.max(this.config.limit, 100)
    });
    return data?.tasks ?? [];
  }
  async task(id) {
    return this.request(`tasks/${id}`);
  }
  // ── 写操作 ──
  /** 更新任务字段（PUT /tasks/{id}）。只传要改的字段，其余由禅道用旧值兜底。 */
  async updateTask(id, fields) {
    return this.request(`tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields)
    });
  }
  /** 创建任务（POST /executions/{id}/tasks）。 */
  async createTask(executionId, fields) {
    return this.request(`executions/${executionId}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields)
    });
  }
  /** 任务状态流转（POST /tasks/{id}/{action}），如 start/finish/close/pause/activate/restart。 */
  async taskAction(id, action, body = {}) {
    return this.request(`tasks/${id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }
};
function renderProjects(projects) {
  if (!projects.length) return "（没有查询到项目，或账号没有项目查看权限）";
  const lines = ["# 项目总览", ""];
  lines.push("| ID | 项目名称 | 状态 | 进度 | 负责人(PM) | 起止日期 |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const p of projects) {
    const pm = typeof p.PM === "object" && p.PM ? p.PM.account ?? p.PM.realname : p.PM;
    const progress = p.progress != null ? `${p.progress}%` : "-";
    lines.push(
      `| ${p.id} | ${p.name ?? "-"} | ${statusOf(PROJECT_STATUS, p.status)} | ${progress} | ${pm ?? "-"} | ${day(p.begin)} ~ ${day(p.end)} |`
    );
  }
  lines.push("");
  lines.push("用 `zentao_project` 查看单个项目的迭代与任务；用 `zentao_standup` 生成早会简报。");
  return lines.join("\n");
}
function renderProject(project, executions) {
  if (!project) return "（未找到该项目，请用 zentao_projects 确认项目 ID 或名称）";
  const pm = typeof project.PM === "object" && project.PM ? project.PM.account ?? project.PM.realname : project.PM;
  const lines = [];
  lines.push(`# 项目：${project.name}（ID ${project.id}）`);
  lines.push("");
  lines.push(`- 状态：${statusOf(PROJECT_STATUS, project.status)}`);
  lines.push(`- 进度：${project.progress != null ? project.progress + "%" : "-"}`);
  lines.push(`- 负责人(PM)：${pm ?? "-"}`);
  lines.push(`- 周期：${day(project.begin)} ~ ${day(project.end)}`);
  if (project.desc) lines.push(`- 描述：${String(project.desc).slice(0, 300)}`);
  lines.push("");
  lines.push("## 迭代（执行）列表");
  if (!executions.length) {
    lines.push("（该项目下没有未结束的迭代，或该账号无迭代查看权限）");
  } else {
    lines.push("| ID | 迭代名称 | 状态 | 进度 | 起止日期 |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const e of executions) {
      lines.push(
        `| ${e.id} | ${e.name ?? "-"} | ${statusOf(EXECUTION_STATUS, e.status)} | ${e.progress != null ? e.progress + "%" : "-"} | ${day(e.begin)} ~ ${day(e.end)} |`
      );
    }
    lines.push("");
    lines.push("用 `zentao_tasks`（传 execution 参数）查看某迭代下的任务。");
  }
  return lines.join("\n");
}
function renderUsers(users) {
  if (!users.length) return "（没有查询到成员，或账号无成员查看权限）";
  const lines = ["# 团队成员", ""];
  lines.push("| 账号 | 姓名 |");
  lines.push("| --- | --- |");
  for (const u of users) lines.push(`| ${u.account} | ${u.realname || "-"} |`);
  lines.push("");
  lines.push("用 `zentao_user_tasks`（传账号）查看某人的任务；账号取上表第一列。");
  return lines.join("\n");
}
function renderTasks(tasks, title = "任务列表") {
  if (!tasks.length) return `# ${title}

（没有匹配的任务）`;
  const lines = [`# ${title}`, ""];
  lines.push("| ID | 任务名称 | 负责人 | 状态 | 优先级 | 预计开始 | 截止 | 进度 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const t of tasks) {
    const assignee = typeof t.assignedTo === "object" && t.assignedTo ? t.assignedTo.account ?? t.assignedTo.realname : t.assignedTo;
    lines.push(
      `| ${t.id} | ${String(t.name ?? "-").slice(0, 40)} | ${assignee ?? "-"} | ${statusOf(TASK_STATUS, t.status)} | ${priOf(t.pri)} | ${day(t.estStarted)} | ${day(t.deadline)} | ${t.progress != null ? t.progress + "%" : "-"} |`
    );
  }
  lines.push("");
  lines.push(`共 ${tasks.length} 条。用 \`zentao_task\` 传 ID 查看单条任务详情。`);
  return lines.join("\n");
}
function renderTask(task) {
  if (!task) return "（未找到该任务）";
  const assignee = typeof task.assignedTo === "object" && task.assignedTo ? task.assignedTo.account ?? task.assignedTo.realname : task.assignedTo;
  const lines = [];
  lines.push(`# 任务：${task.name ?? "-"}（ID ${task.id}）`);
  lines.push("");
  lines.push(`- 负责人：${assignee ?? "-"}`);
  lines.push(`- 状态：${statusOf(TASK_STATUS, task.status)}`);
  lines.push(`- 优先级：${priOf(task.pri)}`);
  lines.push(`- 进度：${task.progress != null ? task.progress + "%" : "-"}`);
  lines.push(`- 预计工时：${task.estimate != null ? task.estimate : "-"}`);
  lines.push(`- 已耗工时：${task.consumed != null ? task.consumed : "-"}`);
  lines.push(`- 预计开始：${day(task.estStarted)}`);
  lines.push(`- 截止日期：${day(task.deadline)}`);
  if (task.desc) lines.push(`- 描述：${String(task.desc).slice(0, 500)}`);
  return lines.join("\n");
}
function renderWriteResult(label, task) {
  if (!task) return `✅ ${label} 已完成`;
  const assignee = typeof task.assignedTo === "object" && task.assignedTo ? task.assignedTo.account ?? task.assignedTo.realname : task.assignedTo;
  const lines = [`✅ ${label} 已完成`];
  lines.push("");
  lines.push(`- 任务：#${task.id ?? "-"} ${task.name ?? ""}`);
  lines.push(`- 状态：${statusOf(TASK_STATUS, task.status)}`);
  lines.push(`- 负责人：${assignee ?? "-"}`);
  lines.push(`- 截止：${day(task.deadline)}`);
  return lines.join("\n");
}
function groupTasksByStatus(tasks) {
  const groups = {};
  for (const t of tasks) {
    const key = String(t.status ?? "unknown");
    (groups[key] ??= []).push(t);
  }
  return groups;
}
function renderUserTasks(account, tasks, today) {
  const lines = [`# 成员任务：${account}`, ""];
  if (!tasks.length) {
    lines.push("（该成员当前没有可查询到的任务）");
    return lines.join("\n");
  }
  const groups = groupTasksByStatus(tasks);
  const order = ["doing", "wait", "pause", "done", "closed", "cancel"];
  const overview = order.filter((k) => groups[k]).map((k) => `${statusOf(TASK_STATUS, k)} ${groups[k].length}`).join(" · ");
  lines.push(`任务总数 ${tasks.length} ｜ ${overview}`);
  lines.push("");
  for (const key of [...order, ...Object.keys(groups).filter((k) => !order.includes(k))]) {
    const list = groups[key];
    if (!list?.length) continue;
    lines.push(`## ${statusOf(TASK_STATUS, key)}（${list.length}）`);
    for (const t of list) {
      const overdue = isOverdue(t, today) ? " ⚠️逾期" : "";
      lines.push(`- #${t.id} ${String(t.name ?? "-").slice(0, 60)}｜优先级 ${priOf(t.pri)}｜截止 ${day(t.deadline)}${overdue}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
function renderStandup(projects, users, userTasks, today) {
  const lines = [];
  lines.push("# 每日早会简报");
  lines.push("");
  lines.push(`> 生成日期：${today} ｜ 由禅道数据自动汇总，供早会同步进展使用。`);
  lines.push("");
  lines.push("## 一、项目进展");
  if (!projects.length) {
    lines.push("（没有查询到项目）");
  } else {
    lines.push("| 项目 | 状态 | 进度 | 负责人 | 截止 |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const p of projects) {
      const pm = typeof p.PM === "object" && p.PM ? p.PM.account ?? p.PM.realname : p.PM;
      const overdue = p.end && String(p.end).slice(0, 10) !== "0000-00-00" && String(p.end).slice(0, 10) < today && !DONE_STATUS.has(String(p.status)) ? " ⚠️" : "";
      lines.push(`| ${p.name ?? "-"} | ${statusOf(PROJECT_STATUS, p.status)} | ${p.progress != null ? p.progress + "%" : "-"} | ${pm ?? "-"} | ${day(p.end)}${overdue} |`);
    }
    lines.push("");
  }
  lines.push("## 二、成员任务");
  if (!users.length) {
    lines.push("（没有查询到成员）");
  } else {
    const usersWithTasks = users.filter((u) => userTasks.has(u.account));
    const usersWithoutTasks = users.filter((u) => !userTasks.has(u.account));
    for (const u of usersWithTasks) {
      const tasks = userTasks.get(u.account);
      const doing = tasks.filter((t) => t.status === "doing");
      const waiting = tasks.filter((t) => t.status === "wait");
      const overdue = tasks.filter((t) => isOverdue(t, today));
      const label = u.realname ? `${u.realname}（${u.account}）` : u.account;
      lines.push(`### ${label} ｜ 进行中 ${doing.length} · 待开始 ${waiting.length} · 逾期 ${overdue.length}`);
      for (const t of doing) lines.push(`- 进行中：${String(t.name ?? "-").slice(0, 60)}（#${t.id}，截止 ${day(t.deadline)}）`);
      for (const t of waiting) lines.push(`- 待开始：${String(t.name ?? "-").slice(0, 60)}（#${t.id}，截止 ${day(t.deadline)}）`);
      if (overdue.length) {
        for (const t of overdue) lines.push(`- ⚠️ 逾期：${String(t.name ?? "-").slice(0, 60)}（#${t.id}，应于 ${day(t.deadline)} 完成）`);
      }
      lines.push("");
    }
    if (usersWithoutTasks.length) {
      lines.push(`（以下成员未查询到任务：${usersWithoutTasks.map((u) => u.realname ? `${u.realname}(${u.account})` : u.account).join("、")}）`);
      lines.push("");
    }
  }
  lines.push("## 三、风险与阻塞（供早会重点讨论）");
  const allOverdue = [];
  for (const [account, tasks] of userTasks) {
    for (const t of tasks) {
      if (isOverdue(t, today)) allOverdue.push({ t, who: account });
    }
  }
  if (allOverdue.length) {
    for (const { t, who } of allOverdue) {
      lines.push(`- ⚠️ #${t.id}「${String(t.name ?? "-").slice(0, 60)}」由 ${who} 负责，已于 ${day(t.deadline)} 逾期`);
    }
  } else {
    lines.push("（当前没有逾期任务）");
  }
  lines.push("");
  lines.push("> 早会建议节奏：① 每人「昨天做了什么 / 今天做什么 / 有什么阻塞」② 对齐项目风险 ③ 确认今日优先级。");
  return lines.join("\n");
}
function buildStandupSection(config) {
  return `# 角色：团队早会主持人（禅道数据助手）

你是一名「团队早会主持人」，帮助一位小团队负责人组织每日早会（晨会/站会），让团队同步工作进展。你能通过禅道（ZenTao）的只读工具拉取真实数据：每个项目的情况、每个人的工作任务情况。

## 你的职责
1. 用 \`zentao_standup\` 生成一份结构化早会简报，或按需用 \`zentao_projects\` / \`zentao_project\` / \`zentao_users\` / \`zentao_user_tasks\` / \`zentao_tasks\` 取更细的数据。
2. 把数据整理成负责人可以直接照着开早会的口径，语言简洁、只讲重点，不要堆砌原始字段。
3. 主动标出需要关注的点：逾期任务、进行中的高优先级任务、临近截止的项目。

## 早会标准节奏（默认按这个组织）
1. **项目进展**：逐个过一遍进行中的项目（状态、进度、是否临近截止/逾期）。
2. **每人三句话**：昨天做了什么、今天要做什么、有没有阻塞。你据任务数据给出"事实底稿"，再由本人确认补充。
3. **风险与阻塞**：把逾期/卡住的事项拎出来，落实负责人与解决时间。
4. **收尾**：用一两句话确定今天最重要的 1-3 件事。

## 使用数据的边界
- 工具返回的是禅道的客观数据，是早会的"事实底稿"，不是结论；要留出让成员补充口头信息的空间（数据可能滞后）。
- 若某成员查询不到任务，如实说明，不要编造任务。
- 查询失败时明确告诉负责人是连接/认证/权限哪一类问题，并给出排查建议（检查 baseUrl 是否可访问、账号密码是否正确、账号是否有相应查看权限、服务器是否开启 REST API）。

## 语气
- 简洁、条理清晰、对事不对人。
- 用中文；优先表格与短列表，方便在早会上快速过一遍。`;
}
function registerTools(ctx, config, client) {
  const today = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  ctx.tools.register(
    defineTool({
      name: "zentao_projects",
      description: "获取禅道中所有项目的列表与进度总览（状态、进度百分比、负责人、起止日期）。想看每个项目的情况、或为早会准备项目进展时调用。可传 status 过滤（all/doing/wait/suspended/closed）。",
      parameters: {
        status: { type: "string", description: "可选：项目状态过滤，如 doing（进行中）；缺省为 all（全部）。" }
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }]
      },
      async execute(args) {
        return renderProjects(await client.projects(args.status));
      }
    })
  );
  ctx.tools.register(
    defineTool({
      name: "zentao_project",
      description: "获取单个项目的详情：基本信息（状态/进度/负责人/周期）+ 该项目的迭代（执行）列表。想深入了解某个项目时调用；id 与 name 二选一，优先 id。",
      parameters: {
        id: { type: "number", description: "项目 ID（可选，与 name 二选一，优先 id）。" },
        name: { type: "string", description: "项目名称（可选，与 id 二选一；支持部分匹配）。" }
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }]
      },
      async execute(args) {
        const projects = await client.projects();
        const project = args.id ? projects.find((p) => String(p.id) === String(args.id)) : args.name ? projects.find(
          (p) => String(p.name).toLowerCase().includes(String(args.name).toLowerCase())
        ) : void 0;
        if (!project) return "（未找到该项目，请先用 zentao_projects 查看项目列表）";
        const executions = await client.executions(project.id);
        return renderProject(project, executions);
      }
    })
  );
  ctx.tools.register(
    defineTool({
      name: "zentao_users",
      description: '获取禅道团队成员列表（账号 + 姓名）。查"每个人的任务"前，先调它拿到成员账号，再传给 zentao_user_tasks。',
      parameters: {},
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }]
      },
      async execute() {
        return renderUsers(await client.users());
      }
    })
  );
  ctx.tools.register(
    defineTool({
      name: "zentao_tasks",
      description: "获取任务列表，支持灵活筛选：按负责人账号（assignedTo）、按状态（status：wait/doing/done/pause/cancel/closed）、按迭代（execution，迭代 ID）、按优先级（pri：1-4）。想查某一批任务时调用。",
      parameters: {
        assignedTo: { type: "string", description: "可选：负责人账号，如 admin；只查该人名下任务。" },
        status: { type: "string", description: "可选：任务状态，如 doing（进行中）、wait（待开始）。缺省为全部。" },
        execution: { type: "number", description: "可选：迭代（执行）ID，只查该迭代下的任务。" },
        pri: { type: "string", description: "可选：优先级 1-4（1 最高）。" }
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }]
      },
      async execute(args) {
        const tasks = args.execution ? await client.tasksByExecution(args.execution, args.status) : await client.tasksBySearch({ assignedTo: args.assignedTo, status: args.status, pri: args.pri });
        return renderTasks(tasks);
      }
    })
  );
  ctx.tools.register(
    defineTool({
      name: "zentao_user_tasks",
      description: '获取某个成员名下的所有任务，并按状态分组统计（进行中/待开始/已完成等），自动标出逾期任务。早会上要了解"某个人的工作情况"时调用。account 可从 zentao_users 获取。',
      parameters: {
        account: { type: "string", required: true, description: "成员账号（登录名），如 admin。" }
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }]
      },
      async execute(args) {
        const tasks = await client.tasksBySearch({ assignedTo: args.account });
        return renderUserTasks(args.account, tasks, today());
      }
    })
  );
  ctx.tools.register(
    defineTool({
      name: "zentao_task",
      description: "获取单个任务的详细信息（负责人、状态、优先级、进度、工时、起止/截止、描述）。想看某个任务详情时调用。",
      parameters: {
        id: { type: "number", required: true, description: "任务 ID。" }
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }]
      },
      async execute(args) {
        return renderTask(await client.task(args.id));
      }
    })
  );
  ctx.tools.register(
    defineTool({
      name: "zentao_standup",
      description: "一键生成「每日早会简报」：自动汇总每个项目的进度、每个成员的任务（进行中/待开始/逾期），并列出风险与阻塞。开早会时先调它，拿到的数据再按需用其他工具下钻。",
      parameters: {},
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }]
      },
      async execute() {
        const projects = await client.projects("doing");
        const users = await client.users();
        const userTasks = /* @__PURE__ */ new Map();
        const results = await Promise.all(
          users.map(async (u) => {
            try {
              return { account: u.account, tasks: await client.tasksBySearch({ assignedTo: u.account }) };
            } catch (error) {
              return { account: u.account, tasks: null, error: error.message };
            }
          })
        );
        for (const r of results) {
          if (r.tasks && r.tasks.length) userTasks.set(r.account, r.tasks);
        }
        return renderStandup(projects, users, userTasks, today());
      }
    })
  );
  ctx.tools.register(
    defineTool({
      name: "zentao_task_update",
      description: "⚠️ 写操作：更新禅道任务的字段（描述/负责人/截止日期/优先级/预估工时/名称/状态等），只传要改的字段即可。用于补描述、派负责人、改期、销账等数据治理动作。会真实修改禅道数据，调用前务必先向用户确认。",
      parameters: {
        id: { type: "number", required: true, description: "任务 ID。" },
        name: { type: "string", description: "可选：任务名称。" },
        desc: { type: "string", description: "可选：任务描述。" },
        assignedTo: { type: "string", description: "可选：负责人账号（派负责人/转派）。" },
        deadline: { type: "string", description: "可选：截止日期，格式 YYYY-MM-DD（改期）。" },
        estStarted: { type: "string", description: "可选：预计开始日期，格式 YYYY-MM-DD。" },
        pri: { type: "string", description: "可选：优先级 1-4（1 最高）。" },
        estimate: { type: "number", description: "可选：预估工时（小时）。" },
        status: { type: "string", description: "可选：直接改状态（wait/doing/done/pause/cancel/closed）。改状态更推荐用 zentao_task_action。" }
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }]
      },
      async execute(args) {
        const a = args;
        const fields = {};
        for (const k of ["name", "desc", "assignedTo", "deadline", "estStarted", "pri", "estimate", "status"]) {
          if (a[k] !== void 0 && a[k] !== "") fields[k] = a[k];
        }
        if (Object.keys(fields).length === 0) return "（没有提供任何要更新的字段，未做改动）";
        const task = await client.updateTask(a.id, fields);
        return renderWriteResult(`任务 #${a.id} 更新`, task);
      }
    })
  );
  ctx.tools.register(
    defineTool({
      name: "zentao_task_action",
      description: "⚠️ 写操作：对禅道任务执行状态流转。action 可选 start（开始）/ finish（完成）/ close（关闭）/ pause（暂停）/ activate（激活，从暂停恢复）/ restart（重启）。用于销账、暂停、重启、关闭等。会真实修改禅道数据，调用前务必先向用户确认。",
      parameters: {
        id: { type: "number", required: true, description: "任务 ID。" },
        action: { type: "string", required: true, description: "流转动作：start / finish / close / pause / activate / restart。" },
        comment: { type: "string", description: "可选：备注。" },
        consumed: { type: "number", description: "可选：本次耗时（小时），start/finish 时可用。" },
        left: { type: "number", description: "可选：剩余工时（小时），start 时可用。" },
        finishedDate: { type: "string", description: "可选：完成日期 YYYY-MM-DD，finish 时用（缺省为今天）。" }
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }]
      },
      async execute(args) {
        const body = {};
        if (args.comment) body.comment = args.comment;
        if (args.consumed !== void 0) body.consumed = args.consumed;
        if (args.left !== void 0) body.left = args.left;
        if (args.action === "finish") {
          body.finishedDate = args.finishedDate || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
          if (args.consumed !== void 0) body.currentConsumed = args.consumed;
        }
        const task = await client.taskAction(args.id, args.action, body);
        return renderWriteResult(`任务 #${args.id} ${args.action}`, task);
      }
    })
  );
  ctx.tools.register(
    defineTool({
      name: "zentao_task_create",
      description: "⚠️ 写操作：在指定迭代（执行）下创建新任务。taskType 取值：devel（开发）/ design（设计）/ request（需求）/ test（测试）/ study（研究）/ discuss（讨论）/ ui（界面）/ affair（事务）/ misc（其他）。会真实修改禅道数据，调用前务必先向用户确认。",
      parameters: {
        executionId: { type: "number", required: true, description: "迭代（执行）ID。" },
        name: { type: "string", required: true, description: "任务名称（建议含交付物）。" },
        assignedTo: { type: "string", required: true, description: "负责人账号。" },
        taskType: { type: "string", required: true, description: "任务类型：devel/design/request/test/study/discuss/ui/affair/misc。" },
        estStarted: { type: "string", required: true, description: "预计开始日期 YYYY-MM-DD。" },
        deadline: { type: "string", required: true, description: "截止日期 YYYY-MM-DD。" },
        pri: { type: "string", description: "可选：优先级 1-4（1 最高）。" },
        estimate: { type: "number", description: "可选：预估工时（小时）。" },
        desc: { type: "string", description: "可选：任务描述。" }
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }]
      },
      async execute(args) {
        const fields = {
          name: args.name,
          assignedTo: args.assignedTo,
          type: args.taskType,
          estStarted: args.estStarted,
          deadline: args.deadline
        };
        if (args.pri) fields.pri = args.pri;
        if (args.estimate !== void 0) fields.estimate = args.estimate;
        if (args.desc) fields.desc = args.desc;
        const task = await client.createTask(args.executionId, fields);
        return renderWriteResult("任务创建", task);
      }
    })
  );
}
function apply(ctx, config) {
  if (config.persona) {
    ctx.systemPrompt.section({
      name: "zentao-standup:role",
      order: 100,
      text: () => buildStandupSection(config)
    });
  }
  const client = new ZentaoClient(config);
  registerTools(ctx, config, client);
  console.log(`[zentao-standup] 已加载（baseUrl=${config.baseUrl.replace(/\/+$/, "")}，工具=10，persona=${config.persona}）`);
}
export {
  Config,
  apply,
  inject,
  name
};
