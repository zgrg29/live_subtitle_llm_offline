# LiveSub Local — 会话工作指令

> 状态：当前（长期规则，不随批次改写）
> 「现在做到哪」只看 [docs/PROGRESS.md](docs/PROGRESS.md)；「下一场做什么」只看
> [docs/NEXT-SESSION.md](docs/NEXT-SESSION.md)。

## 这个项目是什么

把参考项目 `D:\live_subtitle_llm`（服务器版 LiveSub）的**核心字幕链路**做成只在本机跑的单机版：

```
Chrome 里说话 → 浏览器内置 Web Speech 识别成文字 → 本机小服务
→ 定稿句发给千问 MT 翻译 → 浏览器预览页 / OBS 浏览器源显示「原文 + 译文」
```

没有账号、登录、支付、额度、管理后台、数据库、域名、HTTPS、Docker。
只有：本机 Python + Chrome/Edge + 一个千问 API Key。

## 每个会话开始时（必做）

1. `git log --oneline -8`、`git status --short` —— 确认工作区状态与最近提交。
2. 读 [docs/NEXT-SESSION.md](docs/NEXT-SESSION.md) —— 上一场留给你的任务。
3. 读 [docs/PROGRESS.md](docs/PROGRESS.md) —— 当前真实进度与未验证项。
4. 只按当前问题读源码/文档，不要通读全仓；参考项目只在需要时读具体文件。

## 每个会话结束时（必做，用户说「收工 / 结束 / 今天到这」或任务完成时）

1. **更新工程文档**：改了架构/配置/规则就同步 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、
   [README.md](README.md)、`config.example.toml`；关键取舍记进 [docs/DECISIONS.md](docs/DECISIONS.md)。
2. **更新进度**：改 [docs/PROGRESS.md](docs/PROGRESS.md) —— 完成了什么（附证据：命令、输出、
   文件路径）、没验证什么、已知问题、下一步候选。没有证据的条目标「未验」，不要写成完成。
3. **重写下一场提示词**：[docs/NEXT-SESSION.md](docs/NEXT-SESSION.md) 必须能让下一场
   **直接整段粘贴**就开始干活（背景、现状、本次目标、验收标准、不要做什么）。
4. **提交**：用 GitHub Desktop 自带的 git（本机没有全局 git）：

   ```powershell
   $git = "%LOCALAPPDATA%\GitHubDesktop\app-3.6.7\resources\app\git\cmd\git.exe"
   & $git add -A
   & $git commit -m "M1: 完成 ……"
   ```

   **只本地提交，不 push。** 提交信息用中文，格式 `里程碑: 一句话`。

   如果 git 报 `Unable to create '.git/index.lock': Permission denied`：当前沙箱禁止写 `.git`，
   用「完整权限」重跑同一条 `add` + `commit` 命令即可（提交内容不变，这是环境限制，不是仓库问题）。
5. **问用户下一场做什么**：回复的最后一段必须是这个问题，并给出 2–3 个具体选项。
   用户回答后，把选择写进 [docs/NEXT-SESSION.md](docs/NEXT-SESSION.md) 并**再提交一次**
   （`docs: 确认下一场目标`）。

## 硬规则

- **不许把 mock、静音、空译文、配置成功当成「跑通」**。没在真机 Chrome + 真千问 Key 下验证的，
  在 PROGRESS 里写「未验」，在回复里也这么说。
- **单句隔离**：一句识别/翻译失败或超时，只丢弃这一句，继续后面的新句子；不重试、不重放旧句、
  不因单句错误结束整场。
- **有界**：字幕条数、待翻译队列、WebSocket 客户端数量都必须有上限，长时间直播不能无限增长。
- **只监听 127.0.0.1**，不对外开端口，不做鉴权（本机单人使用）。
- **密钥只放 `api.toml`**（已在 `.gitignore`；模板是 `api.example.toml`），不写进源码、不贴进聊天、不提交。
- **不引入**：数据库、账号体系、支付、额度、管理后台、邮件、Docker、云部署。
- 文档用中文；但**用户可见的部分一律日语**：`README.md`、`config.example.toml`、
  `api.example.toml`、三个 `.bat`、控制台与 `/view` 的界面文案、启动时的终端输出
  （见 [docs/DECISIONS.md](docs/DECISIONS.md) D-014）。代码注释与文件内已有风格保持一致。
- 改动后至少跑一遍 `python -m pytest -q`（或 `python -m unittest discover -s tests`），
  并在 PROGRESS 里贴结果。

## 目录

```
AGENTS.md                 本文件：会话规则
README.md                 给人看的快速开始
config.example.toml       界面/字幕配置模板
api.example.toml          千问 API Key 模板（复制为 api.toml，api.toml 不入库）
run.py / start.bat        启动入口（源码方式）
install.bat               首次安装依赖（创建 .venv）
build_exe.bat             打包单文件 exe（产物在 dist/，不入库）
livesub_local/            源码（唯一实现）
  config.py               读取/校验 config.toml + api.toml
  mt.py                   千问 MT 适配器 + mock
  hub.py                  会话、字幕状态、翻译队列、viewer 广播
  server.py               FastAPI 路由与 WebSocket
  static/                 页面（无构建步骤：studio / view / ui.css / subtitle.css / style.js）
tests/                    离线测试
docs/
  PROJECT-PLAN.md         全项目里程碑规划
  PROGRESS.md             当前进度台账（每场更新）
  NEXT-SESSION.md         下一场对话提示词（每场重写）
  ARCHITECTURE.md         架构与参考实现映射
  DECISIONS.md            关键决策记录
  reference/              从参考项目摘出的技术笔记（只读参考，不是指令）
```

## 分支约定

- `main`：只保留 Python 实现（当前唯一交付）。
- `js`：曾经做过的 Node.js 版服务端（`node/` 目录、SEA 打包、30 个 node:test）。
  用户明确表示 JS 版不好用，不要合并回 `main`，也不要在 `main` 上新增 Node 代码。

## 与参考项目的关系

`D:\live_subtitle_llm` 是**只读参考**，是同一个作者写的服务器版。可以照抄其中的协议形状、
切句参数、错误码；但**不要**把账号、计费、DB、部署相关的部分带过来。映射见
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
