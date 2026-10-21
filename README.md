# melon_datakit

OpenAPI 驱动的 **Mock 数据服务平台** —— 导入任意项目的 Swagger / OpenAPI 文档，自动生成符合 schema 的 mock 数据，支持状态化增删查改、错误/延迟模拟、流式上传下载与完整控制台。

前端开发调试不必再等后端：导入文档、复制 Mock 地址、开调。

---

## 特性

| 能力 | 说明 |
|---|---|
| **契约驱动** | 支持 Swagger 2.0 / OpenAPI 3.0 / **3.1**，URL 或文件导入，`$ref` 循环引用安全解析 |
| **中文 mock 数据** | 字段名启发式（姓名/地址/公司/手机号…），faker `zh_CN` |
| **确定性生成** | 同请求同配置 → 字节级相同响应；字段级 seed，schema 增删不导致兄弟字段漂移 |
| **状态化 CRUD** | POST/PUT/DELETE 真实落库（PostgreSQL），GET 反映最新状态，重启不丢 |
| **请求校验** | 按 spec 校验入参；三档模式 strict / lenient（默认）/ off |
| **故障模拟** | 延迟、错误率、强制状态码、整响应覆盖、字段级覆盖 |
| **流式处理** | multipart 流式上传（大文件不进内存）、确定性下载流（Range 断点续传）、SSE 事件流 |
| **完整控制台** | 路由表、规则编辑器、数据浏览器、实时请求日志、设置 |

## 快速开始

### 前置条件

- **Bun 1.4+**（[bun.sh](https://bun.sh)）
- **PostgreSQL 16+**（自备实例，本机安装或远程均可 —— 无 Docker 依赖）

### 1. 安装

```bash
bun install
```

### 2. 配置数据库

Windows 安装 PostgreSQL 后建库：

```powershell
psql -U postgres -c "CREATE DATABASE datakit;"
```

复制环境配置并填入连接串：

```bash
cp .env.example .env
```

```env
# 注意：密码里的特殊字符要 URL 编码（如 # → %23）
DATABASE_URL=postgresql://postgres:你的密码@localhost:5432/datakit
SERVER_PORT=4000
WEB_PORT=3000
SEED_SALT=datakit-dev-salt
LOG_RETENTION_DAYS=7
SEED_ENTITIES_COUNT=10
```

### 3. 初始化表结构

```bash
bun run db:migrate
```

### 4. 启动

```bash
bun run dev      # 开发模式（server 4000 + web 3000 热更新）
bun run build && bun run start   # 生产模式（双进程直跑，无容器）
```

打开 **http://localhost:3000** 进入控制台。

## 使用指南

```
创建项目 → 导入 OpenAPI 文档 → 前端指向 Mock 地址 → 调试
```

1. **新建项目**：控制台首页点「新建项目」，填名称与标识（如 `shop-web`）
2. **导入文档**：项目页左侧「从 URL 导入」或「上传文件」（.json / .yaml）
3. **前端接入**：把请求的 baseURL 指向 Mock 地址

   ```
   http://localhost:4000/p/shop-web
   ```

   文档里的 `/users/{id}` 即对应 `http://localhost:4000/p/shop-web/users/123`

4. **调试**：日志页实时看请求/响应；路由详情页配置规则；数据页管理状态

## 核心概念

### 确定性 Mock 与 seed

同一请求（同路径、参数、body）在同配置下生成**完全相同**的响应 —— 前端可复现任何一次返回。

- 每条响应带 `x-mock-seed` 头；把该值填进规则的「固定 seed」即可锁定某次响应
- 项目设置里的 **seedSalt** 改动会更换整个项目的数据集
- 字段级 seed：给 schema 新增字段时，已有字段的数据不会变

### 状态化 CRUD

从路径模板自动推断 REST 语义：

| 路径 | 方法 | 语义 |
|---|---|---|
| `/users` | GET | 列表（支持 `limit/offset/page/pageSize` 分页与等值过滤） |
| `/users` | POST | 创建（body 覆盖生成字段） |
| `/users/{id}` | GET / PUT / DELETE | 详情 / 合并更新 / 删除（缺实体 → 404） |

- 首次访问自动播种 `SEED_ENTITIES_COUNT` 条种子数据（确定性）
- 数据页「重置」回到种子态
- 非 REST 路径（如 `/report/generate`）自动退化为无状态生成

### 规则（按接口覆盖行为）

| 字段 | 作用 |
|---|---|
| 延迟 | 人为 latency，联调加载态 |
| 错误率 + 错误状态码 | 概率性返回错误，联调错误分支 |
| 强制状态码 | 固定返回指定状态 |
| bodyStatic | 整响应静态覆盖（最高优先级） |
| 字段覆盖 | 按 JSON 路径改写字段：`literal / faker / template / increment / now` |
| 固定 seed | 锁定该接口的生成结果 |
| 校验模式 | 覆盖项目的 strict/lenient/off |

**响应装配优先级**：`bodyStatic > bodyPatch > 字段覆盖 > spec example > schema 生成`

### 请求校验

- `strict`：非法入参返回 400/422 + `details`
- `lenient`（默认）：放行但记告警（响应头 `x-mock-validation: warned`）—— mock 不阻塞前端
- `off`：跳过

### 流式

| 类型 | 行为 | 可调参数 |
|---|---|---|
| 上传 | multipart 流式接收（大文件不进内存），响应含文件名/大小/sha256 | — |
| 下载 | 确定性内容流，支持 `Range` 断点续传 | `?size=字节数`（默认 1MB） |
| SSE | 按 schema 生成事件，中文消息 | `?count=条数` `?interval=毫秒` |

## 配置参考

### 环境变量（`.env`）

| 变量 | 默认 | 说明 |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL 连接串（必填） |
| `SERVER_PORT` | 4000 | Elysia 服务端口（管理 API + mock 流量） |
| `WEB_PORT` | 3000 | Next.js 控制台端口 |
| `SEED_SALT` | datakit-dev-salt | 新项目的默认 seed 盐 |
| `LOG_RETENTION_DAYS` | 7 | 日志保留天数（自动清理） |
| `SEED_ENTITIES_COUNT` | 10 | 首次访问播种条数 |

### 项目级配置（控制台 · 设置页）

locale（zh_CN/en）、校验模式、默认延迟、默认错误率、日志保留天数、种子条数、seedSalt。

## 管理 API 概览

全部在 `/_datakit/admin/*`（控制台经 Next.js rewrites 代理，免跨域）：

```
GET/POST   /projects                    项目列表 / 新建
GET/PATCH  /projects/:id                项目详情 / 修改
DELETE     /projects/:id                删除项目（级联）
POST       /projects/:id/specs          URL 导入
POST       /projects/:id/specs/file     文件导入
GET        /projects/:id/routes         路由表（含 schema）
GET/PUT    /projects/:id/rules          Mock 规则
GET        /projects/:id/entities       实体浏览（?resourceType=&page=）
PATCH      /projects/:id/entities       编辑单条实体
POST       /projects/:id/entities/reset 重置数据
GET        /projects/:id/logs           请求日志（分页/过滤）
GET        /projects/:id/stream         日志实时流（SSE）
DELETE     /projects/:id/logs           清空日志
```

## 开发

```
melon_datakit/
├── apps/server          # Elysia + Bun：管理 API、Mock Dispatcher、流式
├── apps/web             # Next.js 控制台
├── packages/core        # 引擎核心（零 HTTP/DB 依赖，可独立单测）
│   ├── spec/            #   OpenAPI 解析 / 归一化 / CRUD 推断
│   ├── mock/            #   schema → 数据（字段级确定性）
│   ├── validate/        #   请求校验
│   ├── stream/          #   multipart 流解析 / 确定性下载流
│   └── match/seed/...   #   路径匹配、seed 哈希
└── examples/            # 示例 spec
```

```bash
bun test                 # 单元测试（130+）
bun run typecheck        # 全包类型检查
bun run db:generate      # 生成迁移（改 schema 后）
bun run db:studio        # Drizzle Studio 看数据
```

## 示例

`examples/petstore.json` —— 覆盖 CRUD、上传下载、SSE、动作型路径的完整示例：

```bash
# 导入（也可在控制台操作）
curl -X POST http://localhost:4000/_datakit/admin/projects/<id>/specs/file \
  -F "file=@examples/petstore.json"

# 调 mock
curl http://localhost:4000/p/<slug>/pets
curl -X POST http://localhost:4000/p/<slug>/pets -d '{"name":"猫","email":"a@b.com"}' \
  -H 'content-type: application/json'
```

## 常见问题

**启动报 `DATABASE_URL 未设置`**
复制 `.env.example` 为 `.env` 并填入连接串。密码含 `#`、`@` 等字符需 URL 编码。

**SSE / 大文件下载被中途掐断**
本服务对流式请求已关闭 idleTimeout；若经反向代理（nginx 等）转发，需同步调大代理的 `proxy_read_timeout`。

**数据不像我预期的中文？**
项目设置里确认 locale 为 `zh_CN`；字段名启发式只覆盖常见命名（name/address/company…），冷门字段名走通用生成。

**改了 spec 后规则丢了？**
不会 —— 规则以 `(method, 路径模板)` 为键，与文档版本无关。schema 变更时导入响应会提示「请复核」。
