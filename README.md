# 禅道 · 禅道管理助手（dsh-zentao）

面向**小团队负责人**的 [禅道（ZenTao）](https://www.zentao.net) 管理插件，跑在 DeepSeek Harness（DSH）上。
覆盖项目管理的完整闭环：

- ✅ **查询**：项目 / 迭代 / 成员 / 任务，自动标出**逾期**
- ✅ **数据治理（写操作）**：销账、改期、派负责人、派活、建项目、建迭代
- ✅ **每日早会简报**：一键汇总项目进展 + 每人任务 + 风险

它既是团队的数据看板，也是负责人做数据治理的抓手。

## 它能做什么

| 工具 | 作用 | 类型 |
| --- | --- | --- |
| `zentao_standup` | **一键生成「每日早会简报」**：项目进展 + 每人任务 + 逾期/风险汇总 | 读 |
| `zentao_projects` | 所有项目列表与进度总览（状态/进度/负责人/周期） | 读 |
| `zentao_project` | 单个项目详情 + 该项目下的迭代（执行）列表 | 读 |
| `zentao_users` | 团队成员列表（账号 + 姓名） | 读 |
| `zentao_tasks` | 任务列表，按负责人/状态/迭代/优先级灵活筛选 | 读 |
| `zentao_user_tasks` | 某个成员名下的所有任务，按状态分组并标出逾期 | 读 |
| `zentao_task` | 单个任务详情（负责人/状态/优先级/进度/工时/截止） | 读 |
| `zentao_task_update` | **更新任务字段**：描述 / 负责人 / 截止日期 / 优先级 / 预估工时 / 名称 / 状态 | **写** |
| `zentao_task_action` | **任务状态流转**：start / finish / close / pause / activate / restart | **写** |
| `zentao_task_create` | **创建新任务**（需指定迭代、负责人、类型、起止日期） | **写** |
| `zentao_project_create` | **创建项目**（选模型：融合瀑布/敏捷/融合敏捷/看板/瀑布） | **写** |
| `zentao_execution_create` | **创建执行**（阶段 / 迭代 / 看板，可建子阶段/子迭代） | **写** |
| `zentao_execution_update` | **更新执行**（改期/续期、改名称、改负责人、改状态/关闭） | **写** |

共 **13 个工具**：7 个只读 + 6 个写操作。

> ⚠️ **写操作会真实修改禅道数据。** 六个写工具（`zentao_task_*`、`zentao_project_create`、
> `zentao_execution_*`）在调用前，AI 应先向你把要改的内容说清楚、经你确认后再执行。
> 如果只想查询、不想冒任何改动风险，就不调用这些写工具即可。

## 目录结构

```
dsh-zentao/
├── src/index.ts          # 主插件：Config + ZenTao 客户端 + 13 个工具 + 人设
├── dist/index.js         # esbuild 打包产物（bundle 加载的就是它）
├── preset/               # 遗留的 Agent 预设（已不推荐，见下文「配置方式」）
├── examples/             # 冒烟测试（内置 mock 禅道服务器，无需真实禅道）
├── cordis.patch.yml      # bundle 安装用的行声明（含占位默认配置）
├── package.json
└── README.md
```

## 快速开始（bundle 安装，推荐）

1. **安装插件**：在 DSH 的「设置 → 插件」里从 GitHub 安装，或命令行：

   ```bash
   dsh plugin add github:Lz020316/dsh-zentao
   ```

2. **配置禅道**：编辑 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`，追加一段 id 定向覆盖
   （这是**唯一的配置位置**）：

   ```yaml
   - id: zentao
     name: "dsh-zentao"
     config:
       baseUrl: https://你的禅道地址          # 不要带末尾斜杠，如 https://zentao.example.com
       account: 你的登录账号                  # 需有查看项目/迭代/任务/成员的权限
       password: '你的登录密码'
       timeoutMs: 15000
       limit: 100
       persona: true                          # true 时全局注册「禅道管理助手」人设
   ```

3. **重启北极星**，直接说：

   > 今天开早会，帮我拉一下项目进展和每个人的任务。

   它会用 `zentao_standup` 自动生成简报，你也可以让它下钻到某个人/某个项目/某个任务。

> 💡 **懒人配置**：不想手改 YAML？在会话里直接说
> 「配置禅道：地址 xxx、账号 xxx、密码 xxx」，让 DSH 帮你写进上面的位置并验证连通。

## 配置方式（重要）

**配置只有一个地方**：`$DSH_HOME/profiles/<profile>/cordis.patch.yml` 里 `id: zentao`
这一段。改这里保存即热重载（运行中的会话需重启才重新加载）。

> ⚠️ **不要用 `preset/` 里的 Agent 预设方式**：它把配置内联在预设文件里，与 bundle 的
> 默认配置是两套，容易"改了却不见效"。`preset/` 目录仅为历史遗留保留，不推荐使用。

| 字段 | 说明 | 默认 |
| --- | --- | --- |
| `baseUrl` | 禅道服务器地址（含协议，可带子目录），如 `https://zentao.example.com/zentao` | 必填 |
| `account` | 禅道登录账号（需有查看项目/迭代/任务/成员的权限） | 必填 |
| `password` | 禅道登录密码 | 必填 |
| `timeoutMs` | 单次 HTTP 请求超时（毫秒） | `15000` |
| `limit` | 列表类接口默认返回条数上限 | `100` |
| `persona` | 是否注册「禅道管理助手」人设段落 | `false` |

## 其他安装方式

### 源码 checkout（一次性加载）

```bash
pnpm dsh web --patch ./dsh-zentao/cordis.patch.yml
```

此时需把 `cordis.patch.yml` 里的 `name` 改成 `src/index.ts` 或 `dist/index.js` 的绝对路径。

### tarball 安装

```bash
dsh plugin --profile <你的profile> add ./dsh-zentao-1.0.0.tgz
```

## 构建

`dist/index.js` 是 `src/index.ts` 用 esbuild 打包的产物（`@deepseek-ai/*` 保持 external）。
改了 `src/` 后重新打包：

```bash
npx --yes esbuild src/index.ts --bundle --format=esm --platform=node \
  --outfile=dist/index.js --external:'@deepseek-ai/*' --charset=utf8
```

打包后跑 `./examples/run.sh` 回归（冒烟测试内置 mock 禅道服务器，**不需要真实禅道、不需要 API key**）。

## 依赖的禅道 API（版本要求）

本插件调用禅道**开放 REST API v1**（`api.php/v1`），适用于**禅道 18.x 及更高版本**
（已在 **22.6** 上验证）。首次使用请确认你的禅道服务器已开启 REST API（开源版默认开启），
并确认账号有相应查看权限。

用到的端点：

| 端点 | 用途 |
| --- | --- |
| `POST /api.php/v1/tokens` | 认证，拿 token（之后用 `Token` 请求头调用） |
| `GET /api.php/v1/projects` | 项目列表（含进度/状态） |
| `GET /api.php/v1/projects/{id}/executions` | 项目下的迭代 |
| `GET /api.php/v1/users` | 成员列表 |
| `GET /api.php/v1/tasks?search=1&assignedTo=...` | 按人/状态查任务 |
| `GET /api.php/v1/executions/{id}/tasks` | 按迭代查任务 |
| `GET /api.php/v1/tasks/{id}` | 单条任务详情 |

## 排查：连不上怎么办

1. **连接失败**：确认 `baseUrl` 可访问（浏览器打开该地址应能看到禅道登录页）。
2. **认证失败**：确认 `account / password` 正确，且账号没被锁定。
3. **查不到数据/报 400**：确认该账号在禅道里有「项目 / 迭代 / 任务 / 成员」的查看权限。
4. **改了配置没生效**：确认改的是 `profiles/<profile>/cordis.patch.yml` 里 `id: zentao`
   这一段（不是别的文件），并重启会话。
5. **服务器未开启 API**：确认禅道版本 ≥ 18，且 REST API 已启用。

## Roadmap

- [x] 任务写操作：创建任务 / 更新任务字段 / 状态流转（start·finish·close·pause·activate·restart）
- [x] 项目/执行写操作：创建项目（选模型）/ 创建执行（阶段·迭代·看板）/ 更新执行（改期·续期·关闭）
- [ ] 「设置 → 插件 → 插件配置」里的图形化输入框（需为插件补一套客户端 `dsh.client` 卡片 bundle）
- [ ] 需求（Story）、Bug、待办（todo）的查询与写操作
- [ ] 项目关闭、产品归档、团队增员等更细的写操作
- [ ] 写操作的强制审批机制（让 AI 必须先经用户确认再落库，而非仅靠描述约束）

## License

[MIT](./LICENSE) © 2026
