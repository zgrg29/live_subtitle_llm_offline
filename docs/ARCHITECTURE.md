# 架构：LiveSub Local

> 状态：当前（实现变化时同步更新）
> 参考实现：`D:\live_subtitle_llm`（服务器版，只读参考）

## 1. 进程模型

一个本机 Python 进程（FastAPI + uvicorn），只监听 `127.0.0.1:<port>`，没有数据库。
浏览器是唯一的前端：一个 studio 页（控制 + 识别），一个 view 页（OBS 浏览器源）。

```
┌──────────────── Chrome ────────────────┐
│  /studio                               │
│   mic → webkitSpeechRecognition        │
│        → 切句/定稿 → WebSocket          │
└───────────────┬────────────────────────┘
                │ ws /v1/text?source=ja&targets=zh
┌───────────────▼────────────────────────┐        ┌──────────────┐
│ 本机 FastAPI                            │  HTTPS │ 千问 MT API  │
│  Session: 字幕状态 + 翻译队列            │───────▶│ qwen-mt-flash│
│  Hub: 广播快照给所有 viewer              │◀───────│              │
└───────────────┬────────────────────────┘        └──────────────┘
                │ ws /v1/view（快照推送）
┌───────────────▼────────────────────────┐
│  /view （OBS 浏览器源，透明背景）        │
└────────────────────────────────────────┘
```

## 2. 数据流（一次说话）

1. studio 页用 Chrome 内置 Web Speech 连续识别，`interimResults = true`。
2. 前端自己切句（与参考项目同一套参数）：句长 ≥ 14 字、或停顿 800ms、或单句累计 2.5s
   就「定稿」并发送 `{id, text, final:true}`；边说边发 `final:false` 的中间结果。
3. 本机服务收到文本：更新该句的原文，推快照给 viewer。
4. 定稿句进入翻译队列（按句 id 去重，只保留最新文本），**串行**调用千问 MT
   （两次请求之间至少 `min_interval_ms`，默认 120ms）。
5. 翻译成功 → 写入该句译文 → 推快照；失败 → 记录错误码，该句保留原文但不显示译文，
   **继续下一句**。
6. viewer 收到快照后只渲染最后 N 对（N 由 `config.toml` 的 `[display].pairs` 决定），
   旧句子被裁掉。

## 3. 模块

| 文件 | 职责 |
|---|---|
| `livesub_local/config.py` | 读 `config.toml`、环境变量覆盖、校验取值范围 |
| `livesub_local/mt.py` | 千问 MT 适配器（httpx）与 `mock` 适配器；统一错误码 |
| `livesub_local/hub.py` | `Sentence` / `Session` / `Hub`：字幕状态、翻译队列、viewer 订阅与广播 |
| `livesub_local/server.py` | FastAPI 路由、两个 WebSocket、静态页 |
| `livesub_local/static/studio.html` | 控制页 + Web Speech 识别 + 切句 |
| `livesub_local/static/view.html` | OBS 显示页 + 渲染逻辑 |
| `run.py` / `start.bat` | 启动入口（检查端口、开浏览器） |
| `tests/` | 无网络的离线测试（mock 翻译） |

## 4. 与参考实现的映射

| 参考项目 | 单机版 | 说明 |
|---|---|---|
| `hosted.py` 的 `ingest_text()` / `_text_worker()` / `_translate_text()` | `hub.py` 的 `Session.ingest()` / `_worker()` | 去掉额度、时间线、lane pair、审计 |
| `subtitle_gateway.py` 的 `begin_text_sentence()` / `_publish()` | `Session._evict_oldest()` / `_notify()` | 保留「满 N 句先淘汰最旧」的语义 |
| `subtitle_state.py` | `Session` 内部 dict + 顺序表 | 单会话单目标，不需要 route_generation |
| `qwen_mt_http.py` | `mt.py` | 请求体与响应校验保持一致；去掉 trial 证据与审批 |
| `hosted-studio.html` 的识别/切句段（约 1300–1440 行） | `static/studio.html` | 保留 `MAX_CHARS=14`、800ms 停顿、2.5s 上限、flush 逻辑 |
| `hosted-viewer.js` / `hosted-overlay.js` | `static/view.html` | 先做核心渲染；主题系统后置（见 docs/reference/VIEWER-SPEC.md） |
| `hosted.py` 的 `/v1/text/{sid}`、`/v1/view/{sid}` | `/v1/text`、`/v1/view` | 去掉 view token、鉴权、会话生命周期 |
| `config.example.toml`（本地桌面模式的 sherpa/opus） | 新配置 | 不再需要本地模型，只要千问 |

## 5. 失败处理规则（与参考一致）

- **单句隔离**：ASR/MT 单句失败只丢这一句，不影响整场。
- **不重试、不重放**：旧句失败不会在之后补翻；新句正常走。
- **有界**：`max_sentences`（默认 100）与 viewer 队列长度 1（只保留最新快照）。
- **静音不结束**：没有新文本时只是没有更新，连接保持；studio 每 30 秒发 `ping`。
- **整体结束**：只有用户点「停止」或 studio 连接断开时结束。

## 6. 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 302 → `/studio` |
| GET | `/studio` | 控制页 |
| GET | `/view` | OBS 显示页 |
| GET | `/api/health` | `{ok, engine, session}`，用于启动自检 |
| GET | `/api/display` | 显示参数（pairs/字号/位置…）给 view 页 |
| WS | `/v1/text?source=ja&targets=zh,en` | studio 上行：`{type:"ping"}` 或 `{id,text,final}` |
| WS | `/v1/view` | 下行：`{"type":"snapshot", ...}` |

快照形状：

```json
{
  "type": "snapshot",
  "session": "a1b2c3",
  "sentences": [
    {"id": "1", "source": "こんにちは", "final": true,
     "translations": {"zh": "你好"}, "errors": {}}
  ]
}
```

`/api/display` 只在页面加载时取一次：改了 `config.toml` 的显示参数，需要刷新 `/view`
（OBS 里右键 → 刷新）。参考项目是把样式随每条快照下发，所以能自动生效；本版为了简单先不做，
M2 再补「保存即生效」。

## 7. 配置来源

| 文件 | 内容 | 是否入库 |
|---|---|---|
| `config.toml` | 端口、语言、字幕条数、字号、位置 | 否（模板 `config.example.toml`） |
| `api.toml` | 千问 API Key、endpoint、model、超时 | 否（模板 `api.example.toml`） |

`config.py` 启动时同时读这两个文件；环境变量 `LIVESUB_LOCAL_CONFIG` / `LIVESUB_LOCAL_API`
可以改路径，`QWEN_API_KEY` 可以覆盖 Key（测试用）。文件写 UTF-8 BOM 也能读（去掉 BOM 再解析）。

## 8. 安全边界

- 只监听 `127.0.0.1`；不校验 Origin/Host（本机单人，没这个必要，也不做公网）。
- Key 只存在于 `api.toml`（gitignore）与服务进程内存；不写日志、不回传前端。
- 日志里不打印 Key；错误只打印错误码与状态码。

## 9. 打包（frozen 模式）

`build_exe.bat` 用 PyInstaller 打单文件 exe。frozen 后路径规则变了，代码里已处理：

| 用途 | 源码模式 | frozen（exe） |
|---|---|---|
| 配置/密钥文件 | 仓库根目录 | exe 所在目录（`application_dir()`） |
| 页面与模板资源 | `livesub_local/static/` | `sys._MEIPASS`（`bundle_dir()`） |

首次运行时 `_prepare_runtime_files()` 把打包进去的 `*.example.toml` 复制到 exe 旁边。
PyInstaller 运行时会把内置文件解压到 `--runtime-tmpdir` 指定的位置，本项目设成 `.`（exe 目录），
原因见 [DECISIONS D-008](DECISIONS.md)。

## 10. 界面语言与翻译方向

- `/studio` 与 `/view` 的界面文案是**日语**（面向日本主播），不做语言切换。
- 翻译方向固定 **ja → zh**：`studio.html` 里的 `SOURCE_LANG` / `TARGET_LANG` 两个常量。
  `config.toml` 的 `[subtitle].source_language/target_languages` 只是服务端默认值。
- 控制台底部的「OBS 字幕の見た目を変える」提示词描述的是本页真实 DOM
  （`#stage` / `.pair` / `.source` / `.target`）与 CSS 变量
  （`--target-size` / `--source-size` / `--outline` / `--fade` / `--gap`）；
  **改这几个类名或变量名时，必须同步改提示词**。
