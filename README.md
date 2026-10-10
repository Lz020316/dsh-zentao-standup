# 禅道 · 团队早会助手（dsh-zentao-standup）

面向**小团队负责人**的 [禅道（ZenTao）](https://www.zentao.net) 管理插件，跑在 DeepSeek Harness（DSH）上。
每天开早会（晨会/站会）时，一键拉取：

- ✅ **每个项目的情况** —— 项目状态、进度百分比、负责人、起止/截止日期
- ✅ **每个人的工作任务情况** —— 进行中 / 待开始 / 已完成任务，自动标出**逾期**任务

它把禅道的客观数据整理成一份**结构化早会简报**，负责人可以直接照着开早会，团队同步进展。

## 它能做什么

| 工具 | 作用 |
| --- | --- |
| `zentao_standup` | **一键生成「每日早会简报」**：项目进展 + 每人任务 + 逾期/风险汇总 |
| `zentao_projects` | 所有项目列表与进度总览（状态/进度/负责人/周期） |
| `zentao_project` | 单个项目详情 + 该项目下的迭代（执行）列表 |
| `zentao_users` | 团队成员列表（账号 + 姓名） |
| `zentao_tasks` | 任务列表，按负责人/状态/迭代/优先级灵活筛选 |
| `zentao_user_tasks` | 某个成员名下的所有任务，按状态分组并标出逾期 |
| `zentao_task` | 单个任务详情（负责人/状态/优先级/进度/工时/截止） |

全部为**只读**操作，不会改动禅道里的任何数据。

## 目录结构

```
dsh-zentao-standup/
├── src/index.ts          # 主插件：Config + ZenTao 客户端 + 7 个工具 + 人设
├── dist/index.js         # esbuild 打包产物（被 preset/bundle 加载的就是它）
├── preset/
│   ├── preset.yml        # 预设元数据
│   └── agent.cordis.yml  # 预设组装：早会主持人人设 + 引用工具
├── scripts/install.mjs   # 预设安装脚本（自动改写插件绝对路径）
├── examples/             # 冒烟测试（内置 mock 禅道服务器，无需真实禅道）
├── cordis.patch.yml      # bundle 安装用的行声明
├── package.json
└── README.md
```

## 快速开始（作为 Agent 预设，推荐）

```bash
cd dsh-zentao-standup
node scripts/install.mjs --apply
```

然后**编辑** `~/.dsh/.agent-presets/zentao-standup/agent.cordis.yml`，把 `zentao-standup`
一行的 `config.baseUrl / account / password` 改成你自己的禅道服务器地址与账号密码：

```yaml
config:
  baseUrl: http://你的禅道服务器地址/zentao   # 例如 http://192.168.1.100/zentao
  account: admin                              # 你的登录账号
  password: '你的密码'                          # 你的登录密码
```

最后**完全退出并重新打开北极星（DeepSeek Harness 桌面版）**，新建会话时在「模式选择」里选
**「团队早会主持人」**，直接说：

> 今天开早会，帮我拉一下项目进展和每个人的任务。

它会用 `zentao_standup` 自动生成简报，你也可以让它下钻到某个人/某个项目/某个任务。

## 安装方式

### A. Agent 预设（推荐）

如上，用 `scripts/install.mjs --apply`，或手动复制：

```bash
mkdir -p ~/.dsh/.agent-presets/zentao-standup
cp preset/preset.yml ~/.dsh/.agent-presets/zentao-standup/
cp preset/agent.cordis.yml ~/.dsh/.agent-presets/zentao-standup/
# 然后把 agent.cordis.yml 里 zentao-standup 那一行的 name: 改成你本机 dist/index.js 的绝对路径，
# 并填入 baseUrl/account/password
```

### B. 挂到某个 profile（全局生效）

把下面的条目追加到 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`（保存即热重载）：

```yaml
- insert:
    - id: zentao-standup
      name: '/Volumes/LZ_Storage/deepseek-normal/dsh-zentao-standup/dist/index.js'
      config:
        baseUrl: http://你的禅道地址/zentao
        account: admin
        password: '你的密码'
        timeoutMs: 15000
        limit: 100
        persona: true     # 全局挂载时建议 true，自动带上「早会主持人」人设
```

### C. 作为 bundle 安装

```bash
dsh plugin --profile <你的profile> add ./dsh-zentao-standup-1.0.0.tgz
```

## 配置（Config）

| 字段 | 说明 | 默认 |
| --- | --- | --- |
| `baseUrl` | 禅道服务器地址（含协议，可带子目录），如 `http://192.168.1.100/zentao` | 必填 |
| `account` | 禅道登录账号（需有查看项目/迭代/任务/成员的权限） | 必填 |
| `password` | 禅道登录密码 | 必填 |
| `timeoutMs` | 单次 HTTP 请求超时（毫秒） | `15000` |
| `limit` | 列表类接口默认返回条数上限 | `100` |
| `persona` | 是否注册「早会主持人」人设段落（Agent 预设方式用 `false`，人设由 preset 提供） | `false` |

## 构建

`dist/index.js` 是 `src/index.ts` 用 esbuild 打包的产物（`@deepseek-ai/*` 保持 external）。
改了 `src/` 后重新打包：

```bash
npx --yes esbuild src/index.ts --bundle --format=esm --platform=node \
  --outfile=dist/index.js --external:'@deepseek-ai/*' --charset=utf8
```

打包后跑 `./examples/run.sh` 回归（冒烟测试内置 mock 禅道服务器，**不需要真实禅道、不需要 API key**）。

## 依赖的禅道 API（版本要求）

本插件调用禅道**开放 REST API v1**（`api.php/v1`），适用于**禅道 18.x 及更高版本**的开源版/企业版。
首次使用请确认你的禅道服务器已开启 REST API（开源版默认开启），并确认账号有相应查看权限。

用到的端点：

| 端点 | 用途 |
| --- | --- |
| `POST /api.php/v1/tokens` | 认证，拿 token |
| `GET /api.php/v1/projects` | 项目列表（含进度/状态） |
| `GET /api.php/v1/projects/{id}/executions` | 项目下的迭代 |
| `GET /api.php/v1/users` | 成员列表 |
| `GET /api.php/v1/tasks?search=1&assignedTo=...` | 按人/状态查任务 |
| `GET /api.php/v1/executions/{id}/tasks` | 按迭代查任务 |
| `GET /api.php/v1/tasks/{id}` | 单条任务详情 |

## 排查：连不上怎么办

1. **连接失败**：确认 `baseUrl` 可访问（浏览器打开 `http://地址/zentao` 应能看到禅道登录页）。
2. **认证失败**：确认 `account / password` 正确，且账号没被锁定。
3. **查不到数据/报 400**：确认该账号在禅道里有「项目 / 迭代 / 任务 / 成员」的查看权限。
4. **服务器未开启 API**：确认禅道版本 ≥ 18，且 REST API 已启用。

## License

[MIT](./LICENSE) © 2026
