# Free Claude Code (FCC) — Code Wiki

> 本文件是对 `free-claude-code` 仓库的结构化技术说明，涵盖项目整体架构、模块职责、关键类与函数、依赖关系以及运行方式。所有源码引用均为可点击的绝对路径链接。

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术栈与依赖](#2-技术栈与依赖)
3. [仓库目录结构](#3-仓库目录结构)
4. [整体架构](#4-整体架构)
5. [启动流程与生命周期](#5-启动流程与生命周期)
6. [核心模块详解](#6-核心模块详解)
   - [6.1 runtime — 组合根与进程级生命周期](#61-runtime--组合根与进程级生命周期)
   - [6.2 api — FastAPI HTTP 适配层](#62-api--fastapi-http-适配层)
   - [6.3 application — 用例编排层](#63-application--用例编排层)
   - [6.4 providers — 提供商与弹性策略层](#64-providers--提供商与弹性策略层)
   - [6.5 core — 协议与基础设施原语层](#65-core--协议与基础设施原语层)
   - [6.6 cli — 命令行、桌面与客户端启动器](#66-cli--命令行桌面与客户端启动器)
   - [6.7 messaging — 消息平台与会话树](#67-messaging--消息平台与会话树)
   - [6.8 config — 配置体系](#68-config--配置体系)
   - [6.9 harnesses — 客户端集成配置](#69-harnesses--客户端集成配置)
   - [6.10 updater — 自动更新](#610-updater--自动更新)
7. [公共 HTTP API 端点](#7-公共-http-api-端点)
8. [配置项总览](#8-配置项总览)
9. [数据持久化](#9-数据持久化)
10. [模块依赖关系](#10-模块依赖关系)
11. [项目运行方式](#11-项目运行方式)
12. [测试与质量保障](#12-测试与质量保障)
13. [开发约定](#13-开发约定)

---

## 1. 项目概述

**Free Claude Code (FCC)** 是一个开源的**本地代理网关**，把 61+ 个免费/付费/本地的 AI 模型提供商统一接入 11 种编码客户端（Claude Code、Codex、Pi、OpenCode、Cline、Hermes、DeepSeek Harness、Grok Build、Muse Code、Aider、VS Code Chat）。

核心能力：

- **统一模型目录**：所有客户端共享一个可搜索的模型目录，支持分层路由（MODEL / MODEL_FABLE / MODEL_OPUS / MODEL_SONNET / MODEL_HAIKU）。
- **故障无感恢复**：某提供商请求耗尽重试后，自动切换到下一个配置的 Fallback 模型，无需用户重启对话（支持流式中途恢复）。
- **协议桥接**：对外暴露 Anthropic Messages SSE、OpenAI Responses、OpenAI Chat Completions 三套线协议，对内统一调度各提供商的原生/兼容 API。
- **本地管理后台**：Admin UI（仅回环地址可访问）用于配置提供商、模型、Fallback、集成、消息平台。
- **多端接入**：终端启动器、桌面托盘应用、IDE/桌面 App 集成、Discord/Telegram 机器人、浏览器内原生 Code 会话。
- **语音转写**：本地 Whisper（CPU/CUDA）或 NVIDIA NIM 语音转文字。

项目采用 **`src/` 布局**，包名 `free_claude_code`，Python 版本锁定 `3.14.7`，使用 `uv` 管理依赖，`hatch-vcs` 从 Git 标签派生版本号。许可证为 `AGPL-3.0-only`。

---

## 2. 技术栈与依赖

来源：[pyproject.toml](file:///workspace/pyproject.toml)

| 类别 | 选型 |
| --- | --- |
| 语言 | Python 3.14.7（`requires-python = "==3.14.7"`） |
| 包管理 | `uv`（`>=0.12.13`） |
| 构建后端 | `hatchling` + `hatch-vcs`（版本从 VCS 派生） |
| Web 框架 | `fastapi[standard]`（`>=0.141.1`）、`uvicorn`（`>=0.54.0`） |
| HTTP 客户端 | `httpx[socks]`、`httpx2[socks]`、`aiohttp`、`requests[socks]` |
| 数据校验 | `pydantic`（`>=2.14.1`） |
| 日志 | `loguru`（`>=0.7.0`） |
| OpenAI SDK | `openai`（`>=3.29.0`） |
| 消息平台 | `python-telegram-bot`（`>=22.8`）、`discord.py`（`>=2.7.1`） |
| Token 计数 | `tiktoken`（`>=0.13.0`） |
| 数据库 | 标准库 `sqlite3` + `sqlalchemy`（`>=2.1.4`，辅助） |
| 桌面托盘 | `pystray`、`Pillow`（仅 win32/darwin） |
| 剪贴板 | `pyperclip` |
| 其它 | `markdown-it-py`、`python-dotenv`、`tomlkit`、`ruamel-yaml`、`json5`、`jsonschema`、`simplejson`、`google-auth`、`grpcio`、`nvidia-riva-client`、`github-copilot-sdk` |
| 可选 extra `voice_local` | `torch`、`transformers`、`accelerate`、`librosa`（本地 Whisper） |
| 开发依赖 | `pytest`、`pytest-asyncio`、`pytest-cov`、`pytest-xdist`、`pytest-playwright`、`pytest-split`、`ty`（类型检查）、`ruff`（格式化/lint）、`pyyaml` |

### 入口点（console_scripts / gui_scripts）

定义于 [pyproject.toml#L46-L63](file:///workspace/pyproject.toml#L46-L63)：

| 命令 | 入口函数 | 作用 |
| --- | --- | --- |
| `fcc-server` | `cli.entrypoints:serve` | 启动 FastAPI 代理服务器 |
| `fcc-doctor` | `cli.entrypoints:doctor` | 输出本地诊断报告 |
| `fcc-claude` / `fcc-codex` / `fcc-pi` / `fcc-opencode` / `fcc-cline` / `fcc-hermes` / `fcc-dsh` / `fcc-grok` / `fcc-muse` / `fcc-aider` | 各 `cli.launchers.<name>:launch` | 启动对应编码客户端并注入 FCC 配置 |
| `_fcc-update-check` | `updater.check:main` | 后台更新检查 |
| `fcc-desktop`（gui） | `cli.desktop_entrypoint:launch` | 桌面托盘应用入口 |

---

## 3. 仓库目录结构

```
/workspace
├── src/free_claude_code/          # 主源码包（src 布局）
│   ├── api/                       # FastAPI 路由、流式投递、Admin
│   ├── application/               # 用例编排：执行、路由、模型目录
│   ├── cli/                       # 命令行、桌面托盘、客户端启动器
│   ├── config/                    # 配置加载、设置模型、路径、提供商目录
│   ├── core/                      # 协议转换、流式原语、异步工具、推理
│   ├── harnesses/                 # 各客户端/IDE 集成的配置生成与清理
│   ├── messaging/                 # Discord/Telegram 平台、消息树、转写、渲染
│   ├── providers/                 # 61+ 提供商实现 + 准入/失败/恢复策略
│   ├── runtime/                   # 组合根、ASGI、生命周期、SQLite、集成服务
│   ├── updater/                   # 自动更新检查
│   └── assets/                    # 应用图标等静态资源
├── tests/                         # 单元/集成测试（与 src 镜像分目录）
├── e2e/                           # 端到端测试
├── smoke/                         # 活服务冒烟测试（live）
├── scripts/                       # 安装/卸载/CI/发布脚本
├── assets/                        # README 用图片
├── pyproject.toml                 # 项目元数据、依赖、工具配置
├── uv.lock                        # uv 锁文件
├── README.md
├── CONTRIBUTING.md
└── LICENSE
```

测试目录 `tests/` 与 `src/` 一一镜像（`tests/api/`、`tests/providers/` 等），另有 `e2e/` 与 `smoke/` 两套更高层的测试。

---

## 4. 整体架构

FCC 是一个清晰的**分层 + 端口/适配器（Hexagonal）**架构：

```
┌──────────────────────────────────────────────────────────────────┐
│                        客户端 / 接入层                              │
│  编码客户端(Claude Code/Codex/...)  IDE/桌面集成  Discord/Telegram  │
└───────────────┬──────────────────────────┬───────────────────────┘
                │ Anthropic/OpenAI 协议     │ 平台事件
                ▼                          ▼
┌─────────────────────────────┐   ┌─────────────────────────────┐
│         api (FastAPI)        │   │      messaging (平台层)      │
│  路由 / 中间件 / 流式投递     │   │  入站/出站 / 消息树 / 渲染    │
└──────────────┬──────────────┘   └──────────────┬──────────────┘
               │                                  │
               ▼                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    application (用例编排层)                        │
│   ModelRouter / 执行循环 / 模型目录 / 推理策略 / 就绪性 / 会话事件  │
└───────────────────────────────┬─────────────────────────────────┘
                                │ ProviderResolver / RequestRuntimeLease
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                  providers (提供商 + 弹性策略层)                    │
│  BaseProvider / admission(准入) / failure / recovery(流恢复)      │
│  + 61+ 提供商实现(anthropic/openai_chat/codex/copilot/nim/...)   │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                       core (协议与原语层)                          │
│  anthropic 协议转换 / SSE 聚合 / 流式投递状态机 / 异步原语 / 推理  │
└─────────────────────────────────────────────────────────────────┘
        ▲                                    ▲
        │ 生命周期所有权                       │ 配置 / 持久化
┌───────┴──────────┐               ┌─────────┴─────────┐
│  runtime         │               │  config           │
│  组合根/ASGI/SQLite│              │  Settings/加载器  │
│  集成/messaging   │               │  提供商目录       │
└──────────────────┘               └───────────────────┘
```

**关键设计原则**（来自 [CONTRIBUTING.md](file:///workspace/CONTRIBUTING.md)）：

- 共享的 Anthropic 协议行为放在 [`core/anthropic/`](file:///workspace/src/free_claude_code/core/anthropic/)，不从其它提供商导入工具。
- 提供商专属配置归该提供商自己持有。
- `application` 层通过**端口（ports）**与运行时解耦，不直接依赖具体 HTTP 框架或数据库。
- 进程级资源（provider、数据库、集成、messaging）由 `runtime.ApplicationRuntime` 单一所有，确保干净启停。

---

## 5. 启动流程与生命周期

完整链路：CLI → Supervisor → ASGI lifespan → `ApplicationRuntime.start()`。

### 5.1 服务器启动

1. `fcc-server` → [`cli.entrypoints.serve()`](file:///workspace/src/free_claude_code/cli/entrypoints.py#L9-L18)（处理 `--version` 后委托）。
2. → [`cli.commands.serve()`](file:///workspace/src/free_claude_code/cli/commands.py#L71-L80) 创建 [`ServerSupervisor`](file:///workspace/src/free_claude_code/cli/commands.py#L133) 并 `run()`。
3. `ServerSupervisor.run()`：
   - 用 [`InterprocessFileLock`](file:///workspace/src/free_claude_code/core/interprocess_lock.py) 抢占 `server_owner_lock`，保证单实例；
   - 循环 `_run_once()` → `_run_bound()`：通过 `ServerSockets` 预留端口，构造 ASGI app，启动 `uvicorn`；
   - 支持配置变更触发的**优雅重启**（`request_restart()` 递增 generation，置 `server.should_exit`）；
   - 端口占用时用 [`_external_fcc_status()`](file:///workspace/src/free_claude_code/cli/commands.py#L411-L428) 区分“已有 FCC 实例”与“其它程序占用”。
4. `_run_bound()` 调用 [`runtime.bootstrap.build_asgi_app()`](file:///workspace/src/free_claude_code/runtime/bootstrap.py#L43-L102) —— **生产环境唯一组合根**，组装 `ProviderRuntimeManager` / `SQLiteDatabase` / `CodeService` / `ApplicationRuntime` / `ApiServices`，返回 [`RuntimeASGIApp`](file:///workspace/src/free_claude_code/runtime/asgi.py#L9-L64)。
5. uvicorn 触发 ASGI lifespan → [`RuntimeASGIApp._lifespan()`](file:///workspace/src/free_claude_code/runtime/asgi.py#L27-L64)：
   - `lifespan.startup` → `ApplicationRuntime.start()`；
   - `lifespan.shutdown` → `ApplicationRuntime.close()`。

### 5.2 `ApplicationRuntime` 生命周期

[`ApplicationRuntime`](file:///workspace/src/free_claude_code/runtime/application.py#L101-L167) 是**进程级单一资源所有者**，持有 provider_manager、configuration、database、code_service、integrations、messaging 等。

- **`start()`**（[L169-L217](file:///workspace/src/free_claude_code/runtime/application.py#L169-L217)）：
  1. 初始化 `ConfigurationService`；
  2. `provider_manager.start_model_list_refresh()` 启动模型列表刷新；
  3. 注册 catalog 变更回调到集成服务；
  4. 启动 `IntegrationService`（VS Code/Claude Desktop/Codex/JetBrains/DSH 集成）；
  5. 后台清理 retired chat 历史；
  6. 启动 `MessagingService`（Discord/Telegram 机器人、语音转写）；
  7. 启动 `CodeService`（浏览器内原生 Code 会话）。
- **`http_started()`**：uvicorn 就绪后设置 `_http_ready` 事件（messaging 等依赖 HTTP ready），打印 Admin UI 地址。
- **`begin_shutdown()`**：标记 draining，结束长连接观察者响应。
- **`close()`**（[L237-L267](file:///workspace/src/free_claude_code/runtime/application.py#L237-L267)）：取消后台任务 → 等待收尾 → 按顺序关闭 folder_picker → messaging 投递 → code_service → database → transcriber → provider_manager → 已连接账户，使用 [`lifecycle.best_effort()`](file:///workspace/src/free_claude_code/runtime/lifecycle.py) 记录失败但不强制中断。

---

## 6. 核心模块详解

### 6.1 runtime — 组合根与进程级生命周期

路径：[src/free_claude_code/runtime/](file:///workspace/src/free_claude_code/runtime/)

| 文件 | 职责 |
| --- | --- |
| [`bootstrap.py`](file:///workspace/src/free_claude_code/runtime/bootstrap.py) | **唯一生产组合根**：`build_asgi_app()` 组装全部运行时对象并返回 `RuntimeASGIApp`。还包含 `_create_transcriber()`（按 `WHISPER_DEVICE` 选择 NIM/本地 Whisper）。 |
| [`asgi.py`](file:///workspace/src/free_claude_code/runtime/asgi.py) | `RuntimeASGIApp`：把 HTTP 委托给 FastAPI，把 lifespan 映射到 `ApplicationRuntime.start()/close()`，并在日志上下文注入 `instance_id`。 |
| [`application.py`](file:///workspace/src/free_claude_code/runtime/application.py) | `ApplicationRuntime`：进程级生命周期所有者；提供 Admin 配置应用（`apply_admin_config` 带两阶段提交 + 凭据校验）、集成操作、状态快照、文件夹选择等。 |
| [`configuration.py`](file:///workspace/src/free_claude_code/runtime/configuration.py) | `ConfigurationService`：Admin 配置的 prepare/commit，与 `ManagedConfigStore` 协作。 |
| [`provider_manager.py`](file:///workspace/src/free_claude_code/runtime/provider_manager.py) | `ProviderRuntimeManager`：管理 `ProviderRuntime` 生命周期、模型目录刷新、配置热替换（`replace()`）、凭据变更、catalog 状态快照。 |
| [`sqlite_database.py`](file:///workspace/src/free_claude_code/runtime/sqlite_database.py) | `SQLiteDatabase`：连接管理、schema 校验（`user_version` + 列结构）、WAL 模式、进程锁、读写连接池 + 读写信号量。 |
| [`messaging_sqlite.py`](file:///workspace/src/free_claude_code/runtime/messaging_sqlite.py) | `SQLiteMessagingStore`：把消息树（`messaging_trees` / `messaging_nodes`）upsert 到 SQLite，支持 legacy import 与 trim。 |
| [`code_sessions_sqlite.py`](file:///workspace/src/free_claude_code/runtime/code_sessions_sqlite.py) | `SQLiteCodeStore`：浏览器 Code 会话的持久化。 |
| [`messaging_service.py`](file:///workspace/src/free_claude_code/runtime/messaging_service.py) | `MessagingService`：根据配置启动 messaging 存储/导入与 workflow 后台任务；持有 transcriber。 |
| [`integration_service.py`](file:///workspace/src/free_claude_code/runtime/integration_service.py) | `IntegrationService`：管理 VS Code Chat、Claude(VS Code/Desktop)、Codex、JetBrains ACP、DSH Desktop 集成状态；catalog 变化时触发刷新。 |
| [`codex_app_server.py`](file:///workspace/src/free_claude_code/runtime/codex_app_server.py) | `CodexHarnessFactory`：管理 Codex app-server 子进程，通过 JSONL/RPC（`initialize`/`initialized`/`start_turn`/`respond`）双向通信。 |
| [`codex_protocol.py`](file:///workspace/src/free_claude_code/runtime/codex_protocol.py) | Codex app-server 协议的消息模型。 |
| [`codex_catalog.py`](file:///workspace/src/free_claude_code/runtime/codex_catalog.py) | `CodexModelCatalogPublisher`：向 Codex 客户端发布模型目录。 |
| [`folder_picker.py`](file:///workspace/src/free_claude_code/runtime/folder_picker.py) / [`native_folder_dialog.py`](file:///workspace/src/free_claude_code/runtime/native_folder_dialog.py) | 原生文件夹选择对话框（浏览器 Code 会话选工作目录）。 |
| [`lifecycle.py`](file:///workspace/src/free_claude_code/runtime/lifecycle.py) | `best_effort()`：关闭阶段的容错清理工具。 |
| [`retired_chat.py`](file:///workspace/src/free_claude_code/runtime/retired_chat.py) | 清理已退役模型的聊天历史。 |
| [`diagnostics.py`](file:///workspace/src/free_claude_code/runtime/diagnostics.py) | 运行时诊断。 |

**关键依赖**：`runtime` 是最上层，依赖 `api`、`application`、`providers`、`config`、`core`、`messaging`；被 `cli.commands` 调用。

---

### 6.2 api — FastAPI HTTP 适配层

路径：[src/free_claude_code/api/](file:///workspace/src/free_claude_code/api/)

把 `application` 层的能力暴露为 HTTP，并处理线协议（Anthropic SSE / OpenAI）、流式投递、Admin 安全。

| 文件 | 职责 |
| --- | --- |
| [`app.py`](file:///workspace/src/free_claude_code/api/app.py) | `create_app(services)`：FastAPI 工厂，注册 4 个中间件 + 3 个 router（admin/code/主路由），挂载 `CodeError`/`RequestValidationError`/`ApplicationError`/`Exception` 异常处理器（按 `/v1/responses` vs 其它路径选择错误线协议）。 |
| [`routes.py`](file:///workspace/src/free_claude_code/api/routes.py) | 公共 API 路由：`POST /v1/messages`、`POST /v1/responses`、`POST /v1/messages/count_tokens`、`GET /v1/models`、`GET /muse-code/models`、`/stop`、`/`、`/health`，以及对应的 HEAD/OPTIONS 探测。 |
| [`admin_routes.py`](file:///workspace/src/free_claude_code/api/admin_routes.py) | Admin 页面与配置 API：`/admin`、`/admin/api/config`、`/admin/api/config/apply`、状态、提供商测试、集成连接等。 |
| [`code_sessions_routes.py`](file:///workspace/src/free_claude_code/api/code_sessions_routes.py) | 浏览器 Code 会话路由：`/admin/api/code/events` 用 `EventSourceResponse` 推 SSE。 |
| [`ports.py`](file:///workspace/src/free_claude_code/api/ports.py) | `ApiServices`：把 `requests`/`admin`/`tasks`/`web_tools`/`code` 服务注入路由（`app.state.services`）。 |
| [`dependencies.py`](file:///workspace/src/free_claude_code/api/dependencies.py) | FastAPI 依赖：`get_services`、`get_settings`、`require_anthropic_proxy_auth`、`require_proxy_auth`、`resolve_provider`。 |
| [`stream_delivery.py`](file:///workspace/src/free_claude_code/api/stream_delivery.py) | `PublicResponseStream`：公共流式响应核心，逐帧发布 SSE，处理失败终端帧、工具调用缓冲、恢复/继续流。 |
| [`response_streams.py`](file:///workspace/src/free_claude_code/api/response_streams.py) | `bind_response_lifetime()`：流式响应消费完成后释放 `RequestRuntimeLease`。 |
| [`stream_frames.py`](file:///workspace/src/free_claude_code/api/stream_frames.py) | SSE 帧模型。 |
| [`request_ids.py`](file:///workspace/src/free_claude_code/api/request_ids.py) | `RequestCorrelationMiddleware`：为每个请求生成 `request-id` 并注入响应头；`get_request_id` / `attach_request_id_headers`。 |
| [`request_lifetime.py`](file:///workspace/src/free_claude_code/api/request_lifetime.py) | `ClientRequestLifetimeMiddleware`：客户端断开时取消请求。 |
| [`request_outcomes.py`](file:///workspace/src/free_claude_code/api/request_outcomes.py) | `RequestOutcomeMiddleware`：请求结果埋点。 |
| [`request_errors.py`](file:///workspace/src/free_claude_code/api/request_errors.py) | `ordinary_application_error_response()`：把 `ApplicationError` 序列化为所选线协议。 |
| [`admin_security.py`](file:///workspace/src/free_claude_code/api/admin_security.py) | `require_loopback_admin`：Admin 仅限回环地址访问。 |
| [`admin_cache.py`](file:///workspace/src/free_claude_code/api/admin_cache.py) | `AdminNoStoreMiddleware` + `attach_admin_no_store`：Admin 响应禁用缓存。 |
| [`tool_call_buffer.py`](file:///workspace/src/free_claude_code/api/tool_call_buffer.py) | 工具调用帧缓冲，保证流式工具调用的原子投递。 |
| [`model_catalog.py`](file:///workspace/src/free_claude_code/api/model_catalog.py) | `build_models_list_response()` / `build_muse_models_list_response()`：构造 `/v1/models` 响应。 |
| [`validation_log.py`](file:///workspace/src/free_claude_code/api/validation_log.py) | 422 请求体摘要（脱敏）。 |
| [`markdown.py`](file:///workspace/src/free_claude_code/api/markdown.py) / [`detection.py`](file:///workspace/src/free_claude_code/api/detection.py) / [`classifier_projection.py`](file:///workspace/src/free_claude_code/api/classifier_projection.py) | Markdown 处理、客户端检测、分类器投影。 |

**中间件顺序**（[app.py#L49-L52](file:///workspace/src/free_claude_code/api/app.py#L49-L52)）：`AdminNoStoreMiddleware` → `ClientRequestLifetimeMiddleware` → `RequestOutcomeMiddleware` → `RequestCorrelationMiddleware`。

---

### 6.3 application — 用例编排层

路径：[src/free_claude_code/application/](file:///workspace/src/free_claude_code/application/)

不依赖 HTTP 框架，通过 `ports.py` 定义的端口与运行时解耦，是请求执行的核心业务逻辑。

| 文件 | 职责 |
| --- | --- |
| [`execution.py`](file:///workspace/src/free_claude_code/application/execution.py) | 请求执行核心：`MessagesHandler`/`ResponsesHandler` 选择候选 provider 流、应用推理策略、流式投递；候选流循环处理 provider 选择、fallback 恢复、进度超时、清理与追踪。 |
| [`routing.py`](file:///workspace/src/free_claude_code/application/routing.py) | `ModelRouter.resolve()`：把入站 Claude 模型名映射为 主目标 + fallback 目标 + 推理偏好；提供 `route_native_messages` / `route_messages` / `route_count_tokens` / `route_responses` 入口。 |
| [`model_catalog.py`](file:///workspace/src/free_claude_code/application/model_catalog.py) | 从配置模型 + 缓存提供商元数据构建应用模型目录（显示名、wire slug、推理支持）。 |
| [`model_metadata.py`](file:///workspace/src/free_claude_code/application/model_metadata.py) | 提供商模型刷新结果 `ProviderModelRefreshResult`。 |
| [`reasoning.py`](file:///workspace/src/free_claude_code/application/reasoning.py) | 解析 Messages/Responses 请求的推理策略，含 fallback 推理行为与应用级偏好。 |
| [`readiness.py`](file:///workspace/src/free_claude_code/application/readiness.py) | 就绪性探测。 |
| [`ports.py`](file:///workspace/src/free_claude_code/application/ports.py) | 端口抽象：`ProviderResolver`、`RequestRuntimeLease`（`acquire`/`release`/`wait_for_token_estimation`/`model_info`）、只读模型目录端口、`StopResult`。 |
| [`session_events.py`](file:///workspace/src/free_claude_code/application/session_events.py) | 会话事件。 |
| [`connected_accounts.py`](file:///workspace/src/free_claude_code/application/connected_accounts.py) | `ConnectedAccountPort` / `ConnectedAccountStatus` / `ConnectedAccountLoginMode`：OAuth 账户（OpenAI/GitHub Copilot）的登录/断开抽象。 |
| [`code_sessions.py`](file:///workspace/src/free_claude_code/application/code_sessions.py) | `CodeService`：浏览器原生 Code 会话（选目录、运行 Codex、切换 provider/model）。 |
| [`errors.py`](file:///workspace/src/free_claude_code/application/errors.py) | `ApplicationError` 体系（`ApplicationUnavailableError`、`InvalidRequestError` 等）。 |

**请求执行主路径**：`routes._create_messages_response` → `services.requests.acquire()` 拿 `RequestRuntimeLease` → `ModelRouter.resolve()` → 判定 native vs 转换 → `MessagesHandler.create()` → 候选流循环（provider stream + fallback recovery）→ `bind_response_lifetime` 释放 lease。

---

### 6.4 providers — 提供商与弹性策略层

路径：[src/free_claude_code/providers/](file:///workspace/src/free_claude_code/providers/)

两层结构：**顶层弹性策略**（准入/失败/恢复，对所有提供商通用）+ **各提供商实现子目录**。

#### 6.4.1 顶层弹性策略

| 文件 | 职责 |
| --- | --- |
| [`base.py`](file:///workspace/src/free_claude_code/providers/base.py) | `ProviderConfig` + 抽象基类 `BaseProvider`：定义 `cleanup` / `list_model_infos` / `stream_messages` / `stream_responses` 等核心接口。 |
| [`admission.py`](file:///workspace/src/free_claude_code/providers/admission.py) | 准入控制核心：`ProviderExecution`（逻辑执行单元）、`ProviderExecution.run_call`（单次调用 + 失败后按决策重试主循环）、`ProviderAttempt.fail`（错误分类 → retryable 判定）、`ProviderAdmissionController`（速率限制、并发上限、最大尝试次数、恢复窗口；`_open_attempt` 执行前检查 exhausted/terminal）。 |
| [`admission_registry.py`](file:///workspace/src/free_claude_code/providers/admission_registry.py) | `ProviderAdmissionRegistry`：按 `provider_id` + credential 共享/复用 `ProviderAdmissionController` 与容量限制器，实现跨请求准入状态。 |
| [`admission_policy.py`](file:///workspace/src/free_claude_code/providers/admission_policy.py) / [`admission_capacity.py`](file:///workspace/src/free_claude_code/providers/admission_capacity.py) | 准入策略与容量。 |
| [`failure_policy.py`](file:///workspace/src/free_claude_code/providers/failure_policy.py) | `classify_provider_failure()`：把 provider 异常归类为标准化 `ExecutionFailure`，用于重试耗尽后的最终失败。 |
| [`request_recovery.py`](file:///workspace/src/free_claude_code/providers/request_recovery.py) | `RequestRecovery`：请求级恢复与修正授权（认证失败重试、请求体修正、流式内容提交后的重试限制）。 |
| [`stream_recovery.py`](file:///workspace/src/free_claude_code/providers/stream_recovery.py) | `RecoveryController.advance_failure()`：根据是否已交付内容、是否可重试、剩余尝试次数，决定 `EARLY_RETRY` / `MIDSTREAM_RECOVERY` / `FINAL_ERROR`。 |
| [`history_replay.py`](file:///workspace/src/free_claude_code/providers/history_replay.py) | 跨 provider/model 切换时的历史回放。 |
| [`continuation.py`](file:///workspace/src/free_claude_code/providers/continuation.py) | 流式继续（continuation）处理。 |
| [`credential_validation.py`](file:///workspace/src/free_claude_code/providers/credential_validation.py) | `check_credentials()` / `CredentialStatus`：Admin 应用配置时的凭据校验。 |
| [`custom.py`](file:///workspace/src/free_claude_code/providers/custom.py) | 自定义提供商实现。 |
| [`endpoint.py`](file:///workspace/src/free_claude_code/providers/endpoint.py) / [`endpoint_types.py`](file:///workspace/src/free_claude_code/providers/endpoint_types.py) / [`http.py`](file:///workspace/src/free_claude_code/providers/http.py) | HTTP endpoint 抽象与传输。 |
| [`model_listing.py`](file:///workspace/src/free_claude_code/providers/model_listing.py) | 模型列表发现。 |
| [`openai_client.py`](file:///workspace/src/free_claude_code/providers/openai_client.py) / [`openai_stream.py`](file:///workspace/src/free_claude_code/providers/openai_stream.py) | OpenAI 客户端与流复用。 |
| [`reasoning_compatibility.py`](file:///workspace/src/free_claude_code/providers/reasoning_compatibility.py) | 推理能力兼容性映射。 |

#### 6.4.2 提供商运行时

路径：[providers/runtime/](file:///workspace/src/free_claude_code/providers/runtime/)

| 文件 | 职责 |
| --- | --- |
| [`factory.py`](file:///workspace/src/free_claude_code/providers/runtime/factory.py) | `prepare_provider()`：按 `provider_id` 选择 `_SPECIAL_PROVIDER_FACTORIES`（anthropic/nvidia_nim/open_router/openai/github_copilot 等）或默认 `OpenAIChatProvider`，并创建 `ProviderAdmissionController`。 |
| [`runtime.py`](file:///workspace/src/free_claude_code/providers/runtime/runtime.py) | `create_provider()`（运行时创建入口，通过 registry + settings 构造实例）；`ProviderRuntime`：provider 实例生命周期（缓存、懒创建、等待创建任务、清理、异常观察）。 |
| [`discovery.py`](file:///workspace/src/free_claude_code/providers/runtime/discovery.py) / [`config.py`](file:///workspace/src/free_claude_code/providers/runtime/config.py) / [`model_cache.py`](file:///workspace/src/free_claude_code/providers/runtime/model_cache.py) | 提供商发现、运行时配置、模型缓存。 |

#### 6.4.3 提供商实现子目录（代表性）

| 子目录 | 说明 |
| --- | --- |
| [`openai_chat/`](file:///workspace/src/free_claude_code/providers/openai_chat/) | `OpenAIChatProvider`：**大多数 OpenAI 兼容提供商的复用基类**，持有 client / admission / transport；含 `client.py`、`transport.py`、`tool_calls.py`、`reasoning.py`、`stream_output.py`、`request_policy.py`、`behavior.py`、`output_cap.py` 等。 |
| [`anthropic/`](file:///workspace/src/free_claude_code/providers/anthropic/) + [`anthropic_messages/`](file:///workspace/src/free_claude_code/providers/anthropic_messages/) | Anthropic 原生 / Messages passthrough 提供商（`provider.py`、`headers.py`、`models.py`、`discovery.py`、`passthrough.py`、`transport.py`、`wire.py`、`request_policy.py`）。 |
| [`openai_codex/`](file:///workspace/src/free_claude_code/providers/openai_codex/) | ChatGPT 订阅 OAuth 提供商（`auth.py` 登录、`provider.py`、`endpoint.py`、`login.py`）。 |
| [`github_copilot/`](file:///workspace/src/free_claude_code/providers/github_copilot/) | GitHub Copilot SDK 提供商（`auth.py` / `broker.py` / `lifecycle.py` / `login.py` / `native_cli.py` / `provider.py` / `sdk.py` / `types.py`）。 |
| [`nvidia_nim/`](file:///workspace/src/free_claude_code/providers/nvidia_nim/) | NVIDIA NIM：含原生工具 schema/流、请求选项、降级重试、语音转写（`voice.py`）。 |
| `groq/` `mistral/` `deepseek/` `gemini/` `open_router/` `alibaba_cloud/` `cloudflare/` `kilo/` `lmstudio/` `vertex/` `google_openai/` `opencode/` `openai_api/` `openai_responses/` | 各有专属 `client.py` / `provider.py`，多数继承或复用 `OpenAIChatProvider` 的传输与策略。 |

**弹性策略协同**：每次模型发现与请求都经 `admission.start_execution().run_call` → 失败走 `failure_policy` 分类 → 可重试则 `RequestRecovery`/`RecoveryController` 决定早重试/中途恢复/最终错误 → 重试耗尽后 `application` 层切到下一个 fallback 候选。

---

### 6.5 core — 协议与基础设施原语层

路径：[src/free_claude_code/core/](file:///workspace/src/free_claude_code/core/)

无框架依赖的纯逻辑与原语，被上层所有模块复用。

#### 6.5.1 anthropic 协议子包

路径：[core/anthropic/](file:///workspace/src/free_claude_code/core/anthropic/)

| 文件 | 职责 |
| --- | --- |
| [`conversion.py`](file:///workspace/src/free_claude_code/core/anthropic/conversion.py) | Anthropic ↔ OpenAI 协议转换：`tool_use` block → OpenAI function call；`OpenAIConversionError`、`ReasoningReplayMode`。 |
| [`content.py`](file:///workspace/src/free_claude_code/core/anthropic/content.py) | content block 属性读取、类型识别、文本提取。 |
| [`sse_aggregation.py`](file:///workspace/src/free_claude_code/core/anthropic/sse_aggregation.py) | `aggregate_anthropic_sse_to_message()`：把 Anthropic Messages SSE 流组装成完整 JSON message（处理 `message_start`/`content_block_start|delta`/`message_delta`/`error`/`message_stop`，累积 text/thinking/input_json/signature/citations，重组最终内容）。 |
| [`native.py`](file:///workspace/src/free_claude_code/core/anthropic/native.py) | `NativeMessagesOptions` 校验 + 原生 Messages 请求构建（保留 native extra fields、转换 system/content、应用 options）。 |
| [`passthrough.py`](file:///workspace/src/free_claude_code/core/anthropic/passthrough.py) | `NativeMessagesRequest` 封装；原生历史恢复（仅解包 FCC-owned replay state，限制跨 provider/model replay）；Native Messages SSE passthrough（校验事件生命周期、替换 `message_start` 中的 model 为 public model）。 |
| [`thinking.py`](file:///workspace/src/free_claude_code/core/anthropic/thinking.py) | thinking 内容处理。 |
| [`tokens.py`](file:///workspace/src/free_claude_code/core/anthropic/tokens.py) / `tool_results.py` / `image_sources.py` / `models.py` / `errors.py` / `server_tool_types.py` / `utils.py` | token 计数、tool result 分解（`DecomposedToolResult`）、图片源、响应模型、错误、server 工具类型、工具函数。 |

#### 6.5.2 顶层 core 模块

| 文件 | 职责 |
| --- | --- |
| [`stream_delivery.py`](file:///workspace/src/free_claude_code/core/stream_delivery.py) | 流式投递状态机：记录 content released、attempt revision、prefix、transition；`ContextVar` 绑定当前 delivery state。 |
| [`stream_recovery.py`](file:///workspace/src/free_claude_code/core/stream_recovery.py) | `assess_recovery()`：跨 provider/routing/public delivery 的恢复决策（restart/continue/handoff/stop）；`DeliveredPrefix` / `ContinuationSeed` / `SourceRecoverySnapshot`。 |
| [`delivered_response.py`](file:///workspace/src/free_claude_code/core/delivered_response.py) | 已投递响应的生命周期管理。 |
| [`continuation_stream.py`](file:///workspace/src/free_claude_code/core/continuation_stream.py) / [`continuation_overlap.py`](file:///workspace/src/free_claude_code/core/continuation_overlap.py) | 流式继续与重叠策略。 |
| [`history_replay.py`](file:///workspace/src/free_claude_code/core/history_replay.py) | 历史回放（与 provider 层配合）。 |
| [`reasoning.py`](file:///workspace/src/free_claude_code/core/reasoning.py) | `ReasoningControl` / `ReasoningCapability` / `ReasoningEffort` 枚举；`ReasoningPolicy`：默认/关闭/偏好关闭策略，计算是否请求/输出推理与 numeric budget。 |
| [`model_capabilities.py`](file:///workspace/src/free_claude_code/core/model_capabilities.py) | 模型能力描述（推理/工具/流式等）。 |
| [`token_estimation.py`](file:///workspace/src/free_claude_code/core/token_estimation.py) | token 数量估算（预算与速率限制）。 |
| [`rate_limit.py`](file:///workspace/src/free_claude_code/core/rate_limit.py) | `StrictSlidingWindowRateLimiter`：`acquire`/`acquire_if`/async context manager。 |
| [`failures.py`](file:///workspace/src/free_claude_code/core/failures.py) | 失败类型集中定义（执行失败/上游失败/失败原因）。 |
| [`web_tools.py`](file:///workspace/src/free_claude_code/core/web_tools.py) | `WebSearchResult` / `WebFetchResult` 类型。 |
| [`trace.py`](file:///workspace/src/free_claude_code/core/trace.py) | `trace_event()` 链路追踪；`extract_claude_session_id_from_headers()`。 |
| [`diagnostics.py`](file:///workspace/src/free_claude_code/core/diagnostics.py) | `safe_exception_message` / `redacted_exception_traceback`（脱敏诊断）。 |
| [`async_iterators.py`](file:///workspace/src/free_claude_code/core/async_iterators.py) | `AsyncCloseable` 协议 + `try_close_async_iterator()`。 |
| [`async_rwlock.py`](file:///workspace/src/free_claude_code/core/async_rwlock.py) | `AsyncRWLock` 异步读写锁。 |
| [`async_tasks.py`](file:///workspace/src/free_claude_code/core/async_tasks.py) | `run_sync_owned()` 等异步任务原语。 |
| [`interprocess_lock.py`](file:///workspace/src/free_claude_code/core/interprocess_lock.py) | `InterprocessFileLock` 跨进程文件锁（单实例保证）。 |
| [`gateway_model_ids.py`](file:///workspace/src/free_claude_code/core/gateway_model_ids.py) | 网关模型 ID 映射。 |
| [`json_types.py`](file:///workspace/src/free_claude_code/core/json_types.py) | `JsonObject` 等 JSON 类型别名。 |
| [`version.py`](file:///workspace/src/free_claude_code/core/version.py) | `package_version()`。 |
| `openai_chat.py` / `openai_tool_names.py` / `tool_schema_patterns.py` / `windows_dpi.py` | OpenAI chat 工具、工具名归一化、工具 schema 模式、Windows DPI。 |

---

### 6.6 cli — 命令行、桌面与客户端启动器

路径：[src/free_claude_code/cli/](file:///workspace/src/free_claude_code/cli/)

#### 6.6.1 顶层

| 文件 | 职责 |
| --- | --- |
| [`entrypoints.py`](file:///workspace/src/free_claude_code/cli/entrypoints.py) | `serve()` / `doctor()`：薄入口，处理 `--version` 后延迟导入真实实现，保持元数据命令路径不加载服务器组合根。 |
| [`commands.py`](file:///workspace/src/free_claude_code/cli/commands.py) | `serve()` + `ServerSupervisor`：服务器生命周期、单实例锁、配置驱动重启、Admin 浏览器打开、端口占用诊断；`load_server_settings()`、`open_admin_when_ready()`。 |
| [`desktop.py`](file:///workspace/src/free_claude_code/cli/desktop.py) | `DesktopController` / `launch_desktop()`：协调 tray 循环与服务器 owner。 |
| [`desktop_entrypoint.py`](file:///workspace/src/free_claude_code/cli/desktop_entrypoint.py) | `fcc-desktop` GUI 入口：处理 `--export-icon`、macOS 安装、auto-start，委托到 tray。 |
| [`desktop_tray.py`](file:///workspace/src/free_claude_code/cli/desktop_tray.py) | `PystrayDesktopTray`：托盘菜单（Open Admin / Check Status / Restart / Quit）。 |
| [`macos_app.py`](file:///workspace/src/free_claude_code/cli/macos_app.py) / [`desktop_assets.py`](file:///workspace/src/free_claude_code/cli/desktop_assets.py) | macOS 应用包与桌面资源。 |
| [`doctor.py`](file:///workspace/src/free_claude_code/cli/doctor.py) | `fcc-doctor` 诊断报告生成。 |
| [`uvicorn_server.py`](file:///workspace/src/free_claude_code/cli/uvicorn_server.py) | `RuntimeServer`：自定义 uvicorn Server，绑定 `begin_shutdown`/`on_started`/`close_runtime` 回调。 |
| [`server_socket.py`](file:///workspace/src/free_claude_code/cli/server_socket.py) | `ServerSockets.reserve()`：端口预留（SO_REUSEADDR，避免重启间隙被抢占）。 |
| [`local_http.py`](file:///workspace/src/free_claude_code/cli/local_http.py) / [`process_registry.py`](file:///workspace/src/free_claude_code/cli/process_registry.py) | 本地 HTTP 请求、子进程注册表（`kill_all_best_effort`）。 |
| [`clipboard.py`](file:///workspace/src/free_claude_code/cli/clipboard.py) | 剪贴板（doctor 报告复制）。 |

#### 6.6.2 launchers/ — 客户端启动器

路径：[cli/launchers/](file:///workspace/src/free_claude_code/cli/launchers/)

统一模式：[`runner.py`](file:///workspace/src/free_claude_code/cli/launchers/runner.py) 的 `run()` 解析客户端二进制 → 检查代理 → 加载 model catalog → 准备配置 → 启动客户端进程。各 `*_config.py` 生成客户端专属配置（注入 `ANTHROPIC_BASE_URL` / auth / 自定义模型组等），[`common.py`](file:///workspace/src/free_claude_code/cli/launchers/common.py) 提供共享逻辑，[`catalog_http.py`](file:///workspace/src/free_claude_code/cli/launchers/catalog_http.py) 从运行中的服务器拉取 catalog。

支持的客户端启动器：`claude`、`codex`、`pi`、`opencode`、`cline`、`hermes`、`dsh`、`grok`、`muse`、`aider`，各含 `launch()` 入口。

#### 6.6.3 managed/ — 托管 Claude 会话

路径：[cli/managed/](file:///workspace/src/free_claude_code/cli/managed/)

| 文件 | 职责 |
| --- | --- |
| [`manager.py`](file:///workspace/src/free_claude_code/cli/managed/manager.py) | `ManagedClaudeSessionManager`：维护 active/pending/closing sessions，`get_or_create_session()` / `register_real_session_id()` / `remove_session()` / `stop_all()`。 |
| [`session.py`](file:///workspace/src/free_claude_code/cli/managed/session.py) | 单会话生命周期。 |
| [`claude.py`](file:///workspace/src/free_claude_code/cli/managed/claude.py) | 托管 Claude 进程。 |
| [`diagnostics.py`](file:///workspace/src/free_claude_code/cli/managed/diagnostics.py) | 托管会话诊断。 |

---

### 6.7 messaging — 消息平台与会话树

路径：[src/free_claude_code/messaging/](file:///workspace/src/free_claude_code/messaging/)

把 Discord/Telegram 上的消息路由为编码会话（启动 CLI 子进程、转写语音、渲染回复）。

#### 6.7.1 顶层协调

| 文件 | 职责 |
| --- | --- |
| [`workflow.py`](file:///workspace/src/free_claude_code/messaging/workflow.py) | `MessagingWorkflow`：顶层业务协调器，组合 `node_runner` / `turn_intake` / `tree_queue`，处理恢复、状态更新、渲染配置。 |
| [`turn_intake.py`](file:///workspace/src/free_claude_code/messaging/turn_intake.py) | 入站消息入口：平台消息、命令、状态消息、回复树解析、队列准入、排队状态更新。 |
| [`node_runner.py`](file:///workspace/src/free_claude_code/messaging/node_runner.py) | `MessagingNodeRunner`：单节点生命周期（创建 transcript、记录 session、处理节点、失败 claim、更新 UI）。 |
| [`node_event_pipeline.py`](file:///workspace/src/free_claude_code/messaging/node_event_pipeline.py) | CLI 事件管道：`session_info`/transcript 事件/完成/错误 → 更新 UI 与 claim 状态。 |
| [`command_dispatcher.py`](file:///workspace/src/free_claude_code/messaging/command_dispatcher.py) + [`commands.py`](file:///workspace/src/free_claude_code/messaging/commands.py) | `/clear`、`/stop`、`/stats` 命令解析与业务逻辑。 |
| [`voice.py`](file:///workspace/src/free_claude_code/messaging/voice.py) | 平台无关语音核心：`Transcriber`、`PendingVoiceRegistry`，claim/reserve/bind/handoff/cancel 状态控制。 |
| [`transcription.py`](file:///workspace/src/free_claude_code/messaging/transcription.py) | 本地 Whisper 转写服务（`voice_local` extra）。 |
| [`event_parser.py`](file:///workspace/src/free_claude_code/messaging/event_parser.py) / [`models.py`](file:///workspace/src/free_claude_code/messaging/models.py) / [`managed_protocols.py`](file:///workspace/src/free_claude_code/messaging/managed_protocols.py) / [`ui_updates.py`](file:///workspace/src/free_claude_code/messaging/ui_updates.py) / [`limiter.py`](file:///workspace/src/free_claude_code/messaging/limiter.py) / [`safe_diagnostics.py`](file:///workspace/src/free_claude_code/messaging/safe_diagnostics.py) / [`command_context.py`](file:///workspace/src/free_claude_code/messaging/command_context.py) | 事件解析、数据模型、托管协议、UI 更新、速率限制、脱敏诊断、命令上下文。 |

#### 6.7.2 platforms/ — 平台适配

路径：[messaging/platforms/](file:///workspace/src/free_claude_code/messaging/platforms/)

| 文件 | 职责 |
| --- | --- |
| [`ports.py`](file:///workspace/src/free_claude_code/messaging/platforms/ports.py) | 平台抽象端口：`MessagingRuntime` / `OutboundMessenger` / `VoiceCancellation` / `MessagingPlatformComponents`。 |
| [`factory.py`](file:///workspace/src/free_claude_code/messaging/platforms/factory.py) | 按配置创建 `TelegramRuntime` 或 `DiscordRuntime`，注入 limiter/transcriber/outbound/voice cancellation。 |
| [`discord.py`](file:///workspace/src/free_claude_code/messaging/platforms/discord.py) / `discord_inbound.py` / `discord_io.py` | Discord 平台：client 生命周期、入站消息、频道过滤、语音 note、outbound。 |
| [`telegram.py`](file:///workspace/src/free_claude_code/messaging/platforms/telegram.py) / `telegram_inbound.py` / `telegram_io.py` | Telegram 平台：Application 初始化、消息/命令/语音 handler、连接重试、停止。 |
| [`outbox.py`](file:///workspace/src/free_claude_code/messaging/platforms/outbox.py) | 出站消息队列。 |
| [`voice_flow.py`](file:///workspace/src/free_claude_code/messaging/platforms/voice_flow.py) | 平台共享语音流程：语音请求 → 状态消息 → 临时文件 → 转录 → 生成 `IncomingMessage` → 交回 handler。 |

#### 6.7.3 trees/ — 消息树与会话队列

路径：[messaging/trees/](file:///workspace/src/free_claude_code/messaging/trees/)

把同一聊天的对话组织为**消息树**（回复链 = 树路径），支持排队、并发、恢复。

| 文件 | 职责 |
| --- | --- |
| [`manager.py`](file:///workspace/src/free_claude_code/messaging/trees/manager.py) | `MessageTreeManager`：树恢复、事务、节点准入、新建/查找树、入队或 claim、启动 node processor。 |
| [`runtime.py`](file:///workspace/src/free_claude_code/messaging/trees/runtime.py) | 单棵树运行时：维护 graph/queue/active claim，enqueue/claim、完成并继续、队列快照。 |
| [`processor.py`](file:///workspace/src/free_claude_code/messaging/trees/processor.py) | 为 claim 创建 asyncio task，处理执行/取消/失败/完成回调。 |
| [`node.py`](file:///workspace/src/free_claude_code/messaging/trees/node.py) | `MessageNode` / `MessageState` / `MessageReferenceKind`：节点模型与状态更新。 |
| [`queue.py`](file:///workspace/src/free_claude_code/messaging/trees/queue.py) | FIFO 队列（deque + set 去重）。 |
| [`graph.py`](file:///workspace/src/free_claude_code/messaging/trees/graph.py) / [`identity.py`](file:///workspace/src/free_claude_code/messaging/trees/identity.py) / [`repository.py`](file:///workspace/src/free_claude_code/messaging/trees/repository.py) / [`snapshot.py`](file:///workspace/src/free_claude_code/messaging/trees/snapshot.py) / [`transaction.py`](file:///workspace/src/free_claude_code/messaging/trees/transaction.py) / [`transitions.py`](file:///workspace/src/free_claude_code/messaging/trees/transitions.py) / [`ports.py`](file:///workspace/src/free_claude_code/messaging/trees/ports.py) | 树图、身份、持久化仓库、快照、事务、状态转换、端口。 |

#### 6.7.4 transcript/ 与 rendering/

- [`transcript/`](file:///workspace/src/free_claude_code/messaging/transcript/)：`buffer.py`（接收 CLI transcript 事件，维护 thinking/text/tool/subagent 片段）、`renderer.py`、`context.py`、`segments.py`、`subagents.py`。
- [`rendering/`](file:///workspace/src/free_claude_code/messaging/rendering/)：`discord_markdown.py`、`telegram_markdown.py`（MarkdownV2 转义/表格/链接）、`markdown_tables.py`、`profiles.py`（渲染配置）。

---

### 6.8 config — 配置体系

路径：[src/free_claude_code/config/](file:///workspace/src/free_claude_code/config/)

| 文件 | 职责 |
| --- | --- |
| [`loader.py`](file:///workspace/src/free_claude_code/config/loader.py) | `ManagedConfigStore`：管理 `~/.fcc/.env`、读写锁、迁移校验、进程环境变量合并、提交/冲突检测；`compose_settings_snapshot()` 定义优先级（默认 < managed env < process env）；`get_settings()` 全局缓存。 |
| [`settings.py`](file:///workspace/src/free_claude_code/config/settings.py) | `Settings`：Pydantic 模型，应用全部配置 schema（61+ 提供商的 API key 列表、模型引用、代理、速率限制、推理、HTTP 超时、web 工具、日志、语音、消息平台、服务器）。含 `model_validator` 校验 provider 引用唯一性与 fallback key 范围。 |
| [`paths.py`](file:///workspace/src/free_claude_code/config/paths.py) | 集中定义 `~/.fcc/` 下配置目录、managed env、锁文件、数据库、日志路径。 |
| [`constants.py`](file:///workspace/src/free_claude_code/config/constants.py) | `DEFAULT_MODEL`、默认超时等常量。 |
| [`api_keys.py`](file:///workspace/src/free_claude_code/config/api_keys.py) | `ApiKeyList`：单值/数组规范化、去重、空值处理；`first_api_key` / `selected_api_key`。 |
| [`env_files.py`](file:///workspace/src/free_claude_code/config/env_files.py) / [`env_migrations.py`](file:///workspace/src/free_claude_code/config/env_migrations.py) | env 读写与版本迁移（`consolidate_managed_config()` 合并旧/新 env）。 |
| [`custom_providers.py`](file:///workspace/src/free_claude_code/config/custom_providers.py) | `CustomProviderDefinition`：自定义提供商模型。 |
| [`provider_catalog.py`](file:///workspace/src/free_claude_code/config/provider_catalog.py) | `PROVIDER_CATALOG` / `ProviderDescriptor` / `ProviderAuthKind` / `SUPPORTED_PROVIDER_IDS`：61+ 提供商的元数据目录（ID、凭据属性、默认 URL、代理、配置属性）。 |
| [`provider_proxies.py`](file:///workspace/src/free_claude_code/config/provider_proxies.py) | 提供商代理 URL 规范化。 |
| [`server_urls.py`](file:///workspace/src/free_claude_code/config/server_urls.py) | `local_admin_url` / `local_proxy_root_url` 计算。 |
| [`model_refs.py`](file:///workspace/src/free_claude_code/config/model_refs.py) | `ModelFallback` / `ModelFallbacks` / `parse_provider_type`：模型引用与 fallback 解析。 |
| [`reasoning.py`](file:///workspace/src/free_claude_code/config/reasoning.py) | `ReasoningPreference` 枚举配置。 |
| [`nim.py`](file:///workspace/src/free_claude_code/config/nim.py) | `NimSettings`：NIM 专属设置。 |
| [`logging_config.py`](file:///workspace/src/free_claude_code/config/logging_config.py) | `configure_logging()`：loguru JSON 文件 sink + 控制台。 |
| [`errors.py`](file:///workspace/src/free_claude_code/config/errors.py) | 配置错误类型。 |
| `admin/` 子包 | Admin 配置的状态/持久化/状态展示（`state.py`、`persistence.py`、`status.py`、`custom_providers.py`）。 |

**配置优先级**（[loader.py compose_settings_snapshot](file:///workspace/src/free_claude_code/config/loader.py#L151-L204)）：内置默认值 → `~/.fcc/.env`（managed）→ 进程环境变量（后者覆盖前者）。

---

### 6.9 harnesses — 客户端集成配置

路径：[src/free_claude_code/harnesses/](file:///workspace/src/free_claude_code/harnesses/)

为各客户端/IDE 生成或清理连接 FCC 所需的配置文件，由 `runtime.IntegrationService` 调用。

| 文件 | 职责 |
| --- | --- |
| [`integration_cleanup.py`](file:///workspace/src/free_claude_code/harnesses/integration_cleanup.py) | 逐项 disconnect/configure 所有集成（Claude Code、VS Code chat、Codex、JetBrains ACP、Claude Desktop、DSH Desktop）。 |
| [`claude_integration.py`](file:///workspace/src/free_claude_code/harnesses/claude_integration.py) | Claude Code / VS Code：读写 `settings.json`，注入/移除 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`。 |
| [`claude_onboarding.py`](file:///workspace/src/free_claude_code/harnesses/claude_onboarding.py) | 完成 Claude Code onboarding。 |
| [`claude_desktop_integration.py`](file:///workspace/src/free_claude_code/harnesses/claude_desktop_integration.py) | Claude Desktop 集成。 |
| [`codex_integration.py`](file:///workspace/src/free_claude_code/harnesses/codex_integration.py) | Codex：TOML 写入/删除 `model_providers.fcc`（catalog/auth/base URL）。 |
| [`codex_model_catalog.py`](file:///workspace/src/free_claude_code/harnesses/codex_model_catalog.py) | Codex 模型目录。 |
| [`vscode_chat_integration.py`](file:///workspace/src/free_claude_code/harnesses/vscode_chat_integration.py) | VS Code Chat：生成/移除 FCC 自定义模型组，写入 `chatLanguageModels.json`（含 model policy 与 reasoning level）。 |
| [`jetbrains_acp_integration.py`](file:///workspace/src/free_claude_code/harnesses/jetbrains_acp_integration.py) | JetBrains ACP（Claude Agent）集成。 |
| [`dsh_desktop_integration.py`](file:///workspace/src/free_claude_code/harnesses/dsh_desktop_integration.py) + `dsh_config.py` + `dsh_files.py` | DeepSeek Harness Desktop：读写 YAML profile/credentials，添加/删除 provider。 |
| [`environment.py`](file:///workspace/src/free_claude_code/harnesses/environment.py) / [`resources.py`](file:///workspace/src/free_claude_code/harnesses/resources.py) / [`model_policy.py`](file:///workspace/src/free_claude_code/harnesses/model_policy.py) / [`config_file.py`](file:///workspace/src/free_claude_code/harnesses/config_file.py) / [`launch.py`](file:///workspace/src/free_claude_code/harnesses/launch.py) | 共享环境、资源、模型策略、配置文件读写、启动辅助。 |

---

### 6.10 updater — 自动更新

路径：[src/free_claude_code/updater/](file:///workspace/src/free_claude_code/updater/)

[`check.py`](file:///workspace/src/free_claude_code/updater/check.py)：`_fcc-update-check` 入口，检查已发布的稳定版本并触发更新（配套 `scripts/update/fcc-update` 与 `fcc-update.cmd`，作为 wheel shared-scripts 安装）。

---

## 7. 公共 HTTP API 端点

来源：[api/routes.py](file:///workspace/src/free_claude_code/api/routes.py)

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `POST` | `/v1/messages` | Anthropic proxy auth | 创建消息；默认 JSON，`stream=true` 返回 Anthropic SSE |
| `POST` | `/v1/responses` | proxy auth | OpenAI Responses 兼容请求 |
| `POST` | `/v1/messages/count_tokens` | Anthropic proxy auth | token 计数 |
| `GET` | `/v1/models` | proxy auth | 列出代理对外通告的模型（支持 `view` / `X-FCC-Model-View` 切换 Claude/其它视图） |
| `GET` | `/muse-code/models` | proxy auth | Muse Code 期望的直接 Responses 模型列表 |
| `POST` | `/stop` | proxy auth | 停止所有 CLI 会话与 pending 任务 |
| `GET` | `/` | proxy auth | 状态根（status/provider/model） |
| `GET` | `/health` | — | 健康检查 `{"status":"healthy"}` |
| `GET` | `/admin` 及 `/admin/api/*` | 回环地址限制 | Admin UI 与配置 API（见 [admin_routes.py](file:///workspace/src/free_claude_code/api/admin_routes.py)） |
| 多路 | `/admin/api/code/*` | 回环 | 浏览器 Code 会话（含 SSE 事件流 `/admin/api/code/events`） |

所有写端点均有对应 `HEAD`/`OPTIONS` 探测路由返回 `Allow` 头。Admin 路由受 [`require_loopback_admin`](file:///workspace/src/free_claude_code/api/admin_security.py) 保护，仅允许本地回环访问。

---

## 8. 配置项总览

全部配置定义在 [`Settings`](file:///workspace/src/free_claude_code/config/settings.py)（Pydantic 模型，通过环境变量 / `~/.fcc/.env` 注入，`validation_alias` 即环境变量名）。主要分组：

- **模型路由**：`MODEL`（默认）、`MODEL_FABLE` / `MODEL_OPUS` / `MODEL_SONNET` / `MODEL_HAIKU`（分层覆盖）、`MODEL_FALLBACKS`（有序 fallback 列表，每项含 model/effort/api_key_number）、`FCC_CUSTOM_PROVIDERS`。
- **61+ 提供商凭据**：每个提供商一个 `<PROVIDER>_API_KEY`（`ApiKeyList`，支持多 key 编号），如 `NVIDIA_NIM_API_KEY`、`OPENROUTER_API_KEY`、`ANTHROPIC_API_KEY` 等；部分有 `*_BASE_URL`、`*_PROXY`。
- **本地提供商**：`LM_STUDIO_BASE_URL`（默认 `http://localhost:1234/v1`）、`LLAMACPP_BASE_URL`（默认 `http://localhost:8080/v1`）、`OLLAMA_BASE_URL`（默认 `http://localhost:11434`）。
- **推理策略**：`REASONING_POLICY`（默认 `from_client`，不能为 inherit）及 `REASONING_FABLE/OPUS/SONNET/HAIKU`。
- **准入与限流**：`PROVIDER_RATE_LIMIT`、`PROVIDER_RATE_WINDOW`、`PROVIDER_MAX_CONCURRENCY`、`PROVIDER_PROGRESS_TIMEOUT`。
- **HTTP**：`HTTP_READ_TIMEOUT`、`HTTP_WRITE_TIMEOUT`、`HTTP_CONNECT_TIMEOUT`。
- **Web 工具**：`ENABLE_WEB_SERVER_TOOLS`、`WEB_FETCH_ALLOWED_SCHEMES`、`WEB_FETCH_ALLOW_PRIVATE_NETWORKS`。
- **服务器**：`HOST`（默认 `0.0.0.0`）、`PORT`（默认 `8082`）、`FCC_OPEN_BROWSER`、`PROXY_AUTH_ENABLED`、`ANTHROPIC_AUTH_TOKEN`（proxy token，默认 `freecc`）。
- **消息平台**：`MESSAGING_PLATFORM`（`telegram`/`discord`/`none`）、`MESSAGING_RATE_LIMIT`、`MESSAGING_RATE_WINDOW`、`TELEGRAM_BOT_TOKEN`、`ALLOWED_TELEGRAM_USER_ID`、`DISCORD_BOT_TOKEN`、`ALLOWED_DISCORD_CHANNELS`、`ALLOWED_DIR`。
- **语音**：`VOICE_NOTE_ENABLED`、`WHISPER_DEVICE`（`cpu`/`cuda`/`nvidia_nim`）、`WHISPER_MODEL`。
- **日志**：`LOG_LEVEL`、`LOG_RAW_API_PAYLOADS`、`LOG_RAW_SSE_EVENTS`、`LOG_API_ERROR_TRACEBACKS`、`LOG_RAW_MESSAGING_CONTENT` 等（默认均脱敏，仅记录元数据）。

校验规则集中在 `Settings` 的 `@field_validator` / `@model_validator`：模型引用必须 `provider/model` 格式且 provider 合法；fallback 的 api_key_number 不能超过已配置 key 数；`nvidia_nim` 语音必须配 `NVIDIA_NIM_API_KEY`。

---

## 9. 数据持久化

使用 **SQLite**（标准库 `sqlite3`，WAL 模式），单一数据库文件位于 `~/.fcc/`（路径由 [`config.paths.fcc_database_path()`](file:///workspace/src/free_claude_code/config/paths.py) 定义）。

- [`runtime.sqlite_database.SQLiteDatabase`](file:///workspace/src/free_claude_code/runtime/sqlite_database.py)：连接池（读写分离信号量）、schema 迁移校验（`user_version` + 列结构）、进程锁、WAL。
- 表与存储：
  - `messaging_trees` / `messaging_nodes`（[`messaging_sqlite.py`](file:///workspace/src/free_claude_code/runtime/messaging_sqlite.py)）：消息会话树持久化，支持启动时 legacy import 与 trim。
  - Code 会话（[`code_sessions_sqlite.py`](file:///workspace/src/free_claude_code/runtime/code_sessions_sqlite.py)）：浏览器原生 Code 会话。
- 另有 legacy 数据库路径（`legacy_code_database_path`），启动时迁移到新库。

---

## 10. 模块依赖关系

自顶向下的依赖方向（上层依赖下层，下层不反向依赖上层）：

```
cli.commands
    └─ runtime.bootstrap ──┬─ api.app ───────── application ── providers ── core
                          ├─ runtime.application ─ application / providers / messaging / config / core
                          └─ ...
messaging ── core / config / application(code_sessions) / providers(nim voice)
harnesses ── config / core
config    ── (独立，仅依赖 pydantic 等第三方)
core      ── (最底层，无内部依赖)
```

要点：

- `core` 是**最底层**，不依赖任何其它内部模块，被所有层复用。
- `config` 基本独立（纯 Pydantic + 文件 I/O），被所有层读取。
- `application` 通过 `ports.py` 定义的端口与 `providers`/运行时交互，**不直接 import** `api` 或 `runtime`，保持可测试。
- `runtime` 是组合根，import 并实例化所有层；`api` 只通过 `ApiServices` 端口访问运行时能力。
- `providers` 内部：顶层策略 + `runtime/` 工厂管理所有提供商子包；提供商子包复用 `OpenAIChatProvider` 与 `core/anthropic` 的协议能力。

仓库有专门的**导入边界契约测试** [tests/contracts/test_import_boundaries.py](file:///workspace/tests/contracts/test_import_boundaries.py) 与 [test_startup_import_boundaries.py](file:///workspace/tests/contracts/test_startup_import_boundaries.py)，CI 强制分层不被破坏。

---

## 11. 项目运行方式

### 11.1 终端用户安装（来自 README）

```bash
# macOS / Linux
curl -fsSL "https://raw.githubusercontent.com/Alishahryar1/free-claude-code/main/scripts/install.sh" | sh
# Windows PowerShell
& ([scriptblock]::Create((irm "https://raw.githubusercontent.com/Alishahryar1/free-claude-code/main/scripts/install.ps1")))
```

安装后：

```bash
fcc-server          # 启动服务器（Linux）；Win/macOS 从桌面/开始菜单打开
fcc-claude          # 启动 Claude Code（其它：fcc-codex / fcc-pi / ...）
fcc-doctor          # 诊断报告
fcc-update          # 更新到最新稳定版
```

### 11.2 本地开发运行（来自 CONTRIBUTING.md）

前置：安装 [uv](https://docs.astral.sh/uv/)（uv 会自动安装项目要求的 Python 3.14.7）。

```bash
git clone https://github.com/Alishahryar1/free-claude-code.git
cd free-claude-code
uv run fcc-server          # 直接从源码 checkout 运行服务器
```

> 约定：用 `uv run` 执行所有 Python 命令，**不要**用全局 Python 解释器运行项目。

### 11.3 运行单个入口/命令

```bash
uv run fcc-server --version       # 仅打印版本，不启动
uv run fcc-doctor                 # 诊断
uv run python -c "from free_claude_code.core.version import package_version; print(package_version())"
```

### 11.4 配置

- 主要通过 **Admin UI**（服务器启动后自动打开浏览器，地址见日志，默认 `http://localhost:<PORT>/admin`）。
- 也可编辑 `~/.fcc/.env`（managed env）或导出环境变量，见 [§8 配置项总览](#8-配置项总览)。

---

## 12. 测试与质量保障

### 12.1 测试套件

| 目录 | 性质 | 说明 |
| --- | --- | --- |
| [`tests/`](file:///workspace/tests/) | 单元/集成 | 与 `src/` 镜像，覆盖 api/application/cli/config/core/messaging/providers/runtime/harnesses/scripts/contracts。 |
| [`tests/contracts/`](file:///workspace/tests/contracts/) | 契约测试 | 导入边界、启动边界、协议矩阵、能力映射、打包契约、版本策略、smoke 隔离等。 |
| [`e2e/`](file:///workspace/e2e/) | 端到端 | Admin、代码会话、集成、消息存储恢复、渐进启动等。 |
| [`smoke/`](file:///workspace/smoke/) | 活服务冒烟 | `live` 标记，需真实服务/凭据，分 `prereq`/`product`/`desktop`/`installers`/`lib`。 |

pytest 配置（[pyproject.toml#L142-L163](file:///workspace/pyproject.toml#L142-L163)）：`pythonpath = ["src", "."]`，`-n auto --dist=worksteal` 并行，`filterwarnings = ["error", ...]`（警告即失败），自定义 marker：`live` / `interactive` / `provider` / `messaging` / `cli` / `clients` / `voice` / `contract`。

### 12.2 本地 CI 序列

```bash
./scripts/ci.sh        # macOS/Linux
.\scripts\ci.ps1       # Windows
# 支持 --only / --skip / --dry-run（或 -Only / -Skip / -DryRun）
```

### 12.3 单项质量命令

```bash
uv run ruff format              # 格式化
uv run ruff check --fix         # lint 修复
uv run ty check                 # 类型检查（ty）
uv run pytest -v --tb=short     # 测试
```

> CI 中 Ruff 为 check-only，并禁止 `# type: ignore` / `# ty: ignore` 与遗留注解变通写法——必须修复根本的类型与导入边界问题。

### 12.4 工具链配置

- **Ruff**：target py314，行宽 88，启用 E/W/F/I/UP/B/C4/SIM/PERF/RUF；忽略 E501（formatter 管）、B008（FastAPI `Depends()` 默认参数有意）、RUF006（fire-and-forget task 有意不 await）。`known-first-party = ["free_claude_code", "smoke"]`。
- **ty**：Python 3.14；`torch`/`transformers`/`librosa`/`pystray`/`PIL` 为可选/平台依赖，允许 unresolved。
- **版本**：`hatch-vcs` 从 Git 标签派生，合并后由发布流程计算版本、打 tag、发布 PyPI 与 GitHub Releases——**不要手动改版本号**。

---

## 13. 开发约定

来自 [CONTRIBUTING.md](file:///workspace/CONTRIBUTING.md) 与代码结构：

1. 目标 Python **3.14**，依赖原生惰性注解，**不要**加 `from __future__ import annotations`；可使用 3.14 无括号多异常捕获（`except TypeError, ValueError:`）。
2. 共享 Anthropic 协议行为放在 [`core/anthropic/`](file:///workspace/src/free_claude_code/core/anthropic/)，不从其它提供商导入工具。
3. 提供商专属配置归该提供商自己持有。
4. 完成迁移时移除死兼容代码，除非需保留已发布接口。
5. PR 标题：改动 `assets/`/`scripts/`/`src/`/`pyproject.toml`/`uv.lock` 时须以 `patch: ` / `minor: ` / `major: ` 开头（冒号后恰好一个空格）；不涉及这些路径的 PR 不得用发布前缀。
6. 改动需附带聚焦的测试与相关 README/文档更新；独立文档 PR 仅仓库所有者可开。
7. 不要提 Docker 集成 PR。

---

*本文档基于仓库当前源码自动分析生成，随代码演进请同步更新。*
