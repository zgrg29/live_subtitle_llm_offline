# 项目规划：LiveSub Local（线下单机版实时字幕）

> 状态：当前（活的规划文件；里程碑、范围变化时更新）
> 实际进度看 [PROGRESS.md](PROGRESS.md)，下一场任务看 [NEXT-SESSION.md](NEXT-SESSION.md)。

## 1. 一句话目标

在自己电脑上双击启动，用 Chrome 打开 `http://127.0.0.1:8765/studio`，对着麦克风说日语，
页面和 OBS 里立刻出现「日语原文 + 中文译文」字幕。

只依赖三样东西：**本机 Python**、**Chrome/Edge 浏览器**、**一个千问 API Key**。

## 2. 从服务器版继承什么、去掉什么

参考实现：`D:\live_subtitle_llm`（同一作者，FastAPI + SQLite + Caddy + Square 支付的线上服务）。

| 参考实现的能力 | 单机版怎么办 |
|---|---|
| 浏览器内置 Web Speech 识别，音频不上传 | **保留**（Chrome/Edge 内识别，本机服务只收文字） |
| 只对定稿句翻译，每句一次 | **保留** |
| WebSocket 推字幕快照给预览页和 OBS 浏览器源 | **保留**（只监听 127.0.0.1） |
| 单句隔离、不重试、有界队列 | **保留** |
| 2–6 对字幕、字号、位置、主题 | **保留**（先做核心项，主题后置） |
| 账号、登录、会话、角色 | 删除 |
| 额度、计费、Square 支付、价格条款 | 删除 |
| SQLite / PostgreSQL 时间线、账单、审计 | 删除（最多写本地日志文件） |
| 管理后台、邮件、运营披露页 | 删除 |
| Docker Compose、Caddy、HTTPS、域名、systemd | 删除（不部署，只本机） |
| 多目标语言、术语表、OCR/上传 | **后置**（M5 可选） |

> 注意用词：本项目的「线下/本地」指**不需要服务器、不对外提供服务**，
> 不等于「完全离线」——语音识别走 Chrome 自带的在线服务，翻译走千问 API，都需要联网。

## 3. 里程碑与验收标准

状态标记：`未开始` / `进行中` / `已完成`。每项完成后在 [PROGRESS.md](PROGRESS.md) 写证据。

### M0 工程基座（本次会话）

交付：git 仓库、配置模板、工作流文档、可启动的最小服务（能返回 studio 页面和健康接口）。

验收：
- [x] `D:\live_subtitle_llm_offline` 是 git 仓库，首次提交完成
- [x] `python run.py` 启动后 `http://127.0.0.1:8765/api/health` 返回 200 且 `engine` 正确
- [x] `/studio` 与 `/view` 页面能打开
- [x] `api.example.toml` 是 Key 模板、`api.toml` 已被 gitignore；`config.example.toml` 只有界面配置

### M0.5 单文件 exe（本次会话）

交付：`build_exe.bat` → `dist\LiveSubLocal.exe`；双击运行、首次生成配置、自动开浏览器。

验收：
- [x] 打包成功，产物 ~16 MB
- [x] 在干净文件夹里双击（命令行启动）后：自动生成 `api.toml`、`/api/health` 返回 200、`/studio` 正常
- [x] exe 内 WebSocket 收文本 → 出译文（mock 引擎）
- [ ] 在真实桌面双击、浏览器自动弹出的观感（未验：命令行启动不触发浏览器）

### M1 最小闭环（说话 → 翻译 → 显示）

交付：studio 页语音识别 + 切句、WebSocket 文本入站、千问 MT、viewer 实时显示。

验收（必须真机，不能只用测试）：
- [ ] 真机 Chrome + 真千问 Key：说 3 句日语，`/view` 在每句定稿后 **1.5 秒内**出现中文译文
- [ ] 没有 Key 时页面明确显示「mock 模式」，译文带明显 mock 标记，不冒充真实翻译
- [ ] 一句话翻译失败（429/超时/断网）：该句没有译文，但下一句继续出
- [ ] 关闭 studio 再打开，viewer 自动跟随新会话，不残留旧字幕
- [ ] 页码/控制台无报错；websocket 断开后 studio 有明确提示

### M2 显示与 OBS 打磨

交付：2–6 对字幕可配、新句在下/上可选、字号/描边/位置/淡入淡出、无新句自动淡出、
OBS 固定地址、1920×1080 设计稿。

验收：
- [ ] OBS 浏览器源（1920×1080、透明背景）里 3 对字幕清晰、不闪烁、不错位
- [ ] 改 `config.toml` 的字号/对数/位置后刷新页面即生效
- [ ] 停说 6 秒后字幕淡出，重新说话立刻恢复
- [ ] 60 句连续输出后页面仍只保留配置的对数，不堆积

### M3 稳定性与延迟

交付：有界队列与内存、断线重连、静音心跳、延迟埋点（识别定稿→MT 返回→显示）、
长跑 30 分钟不崩。

验收：
- [ ] 连续 30 分钟真实使用，进程内存增长 < 50 MB，字幕数不超过上限
- [ ] 每条定稿句有 JSONL 延迟记录：`final_ms`、`mt_ms`、`total_ms`
- [ ] Chrome 自动断开识别（长时间静音）后能自动恢复，不需要人点
- [ ] 千问 429 连续出现时退避但仍继续处理新句，不雪崩

### M4 上手体验

交付：双击 `start.bat` 启动、自动开浏览器、端口占用提示、Key 缺失/无效提示、
日志文件、OBS 地址一键复制、配置校验。

验收：
- [ ] 一台只装了 Python 的 Windows 机器，从解压到出字幕 ≤ 5 分钟，全程不用命令行
- [ ] Key 填错时页面给出可读中文提示，不出现 Python traceback
- [ ] 8765 被占用时提示改端口，而不是直接崩

### M5 可选增强（用户点头才做）

- 多目标语言同时显示
- 术语表 / 固定译法（参考项目 `glossary/`）
- 历史字幕保存为 txt/srt
- 本地离线 ASR 备选（sherpa-onnx，参考项目 `asr/sherpa_offline.py`）

## 4. 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| 运行时 | Python 3.13 | 本机已有；参考项目同语言，逻辑可移植 |
| HTTP/WS | FastAPI + uvicorn | 与参考一致；WebSocket 简单 |
| 前端 | 原生 HTML/JS/CSS，无构建 | OBS 内嵌 Chromium 直接跑，不需要 npm |
| 识别 | Chrome/Edge `webkitSpeechRecognition` | 参考项目同路线，零模型下载，延迟低 |
| 翻译 | 千问 `qwen-mt-flash` HTTP | 与参考同一模型与协议 |
| 存储 | 无数据库；`config.toml` + 可选 JSONL 日志 | 单机单人，不需要状态持久化 |

千问 MT 请求形状（与参考 `qwen_mt_http.py` 一致）：

```
POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
Authorization: Bearer <key>
{
  "model": "qwen-mt-flash", "stream": false, "max_tokens": 512,
  "messages": [{"role": "user", "content": "<日语原文>"}],
  "translation_options": {"source_lang": "Japanese", "target_lang": "Chinese"}
}
→ choices[0].message.content
```

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Web Speech 只有 Chrome/Edge 支持，且依赖 Google 在线识别 | 其他浏览器不可用；国内网络可能不稳 | 页面检测并明确提示；网络问题给出可读错误；M5 再考虑本地 ASR |
| 千问 MT 限流 / 超时 | 个别句子没译文 | 单句隔离；两句之间最小间隔；不重试旧句（与参考一致） |
| OBS 浏览器源渲染差异（字体、缩放） | 字幕错位 | 固定 1920×1080 设计稿；只用 CSS 变量调参；M2 实测截图 |
| `config.toml` 明文 Key | 泄露 | 已 gitignore；README 提醒不要截图/上传 |
| 用户以为「本地版 = 全离线」 | 期望落差 | README / studio 页面明确写清依赖联网 |
| 单进程 + 单会话 | 不能多人同时用 | 明确不做；多人需求属于服务器版 |

## 6. 明确不做

- 账号、登录、注册、找回密码
- 支付、价格、条款、发票、退款
- 额度、计费、字符统计、试用限制
- 管理后台、运营面板、邮件通知
- 数据库、备份、迁移
- 公网部署、域名、HTTPS、反向代理、Docker
- 多用户/多会话并发、权限

## 7. 顺序与依赖

```
M0 ──▶ M1 ──▶ M2 ──▶ M3 ──▶ M4 ──▶ (M5 可选)
       │
       └─ 必须先有真机 Chrome + 真 Key 的验收，才能宣布 M1 完成
```

M1 之前不碰显示主题；M2 之前不碰性能优化；没有真机证据不进入下一里程碑。
