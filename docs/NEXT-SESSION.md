# 下一场对话提示词

> 状态：当前（每场结束重写，下一场可直接整段粘贴）
> 生成时间：2026-11-02
> 默认目标：**真机验收（Node 版）**，通过后把默认交付切到 Node

## 直接复制下面整段给新对话

```
继续 D:\live_subtitle_llm_offline 项目（LiveSub Local：本机实时字幕，日本語 → 中文）。

开工前先读：AGENTS.md、docs/PROGRESS.md、docs/NEXT-SESSION.md、docs/ARCHITECTURE.md。
参考项目 D:\live_subtitle_llm 只读，别改。

背景：把服务器版 LiveSub 的核心链路做成单机版；浏览器 Web Speech 识别 → 本机服务
→ 千问 qwen-mt-flash 翻译 → /view 给 OBS 显示。控制台是 Apple 风格、三语界面（日中英），
可切换千问区域（cn/intl）、25 种识别/译文语言。

现状（2026-11-02）：
- 两套服务端并存：Python（livesub_local/，当前默认交付）和 Node.js（node/，零 npm 依赖）。
  前端 static/ 两份共用，协议与 /api/* 完全一致。
- Python 版：41 个 unittest 通过；exe 16 MB（dist/LiveSubLocal.exe）。
- Node 版：28 个 node:test 通过；SEA exe 约 94 MB（node/dist/LiveSubLocal.exe），冒烟通过。
- 两版都没有做真机 Chrome 语音 + 真千问 Key + OBS 的验收。

本次目标（按顺序）：
1. 让用户用 Node 版跑一次真机：node\dist\LiveSubLocal.exe（或 node 目录下 node src/run.mjs），
   在 Chrome 里说 3 句日语，确认 /view 出中文、控制台样式面板实时生效。
2. 让用户填真 Key（自己填 api.toml，不要索取），点「接続テスト」确认 cn 或 intl 能通。
3. 记录实测延迟、切句是否碎、有没有丢句；写进 PROGRESS。
4. 用户确认 Node 版没问题后：把默认交付切到 Node
   （README/start.bat/build_exe.bat 指向 node 版；把 livesub_local/static 挪到根 static/；
   删除或归档 Python 版；更新 .gitignore）。
5. 没通过就修，别急着切换。

验收标准：
- 3 句日语都出中文，单句定稿→显示 ≤ 1.5 秒（用户实测）。
- 样式面板改动在 /view 立刻可见，不用刷新 OBS。
- 切换默认后，仓库只有一个服务端实现，测试仍全绿。

限制：
- 不要 push；提交用 GitHub Desktop 自带的 git：
  %LOCALAPPDATA%\GitHubDesktop\app-3.6.7\resources\app\git\cmd\git.exe
- 界面/配置/终端输出一律日语；README 日语；docs/ 用中文。
- 本会话沙箱：写 .git、系统 Temp、%LOCALAPPDATA% 都被限制；git/pip/打包/跑 exe 需要「完整权限」。
  跑 node 测试要用 `node --test --test-isolation=none test/config.test.mjs test/hub.test.mjs test/server.test.mjs`
  （`node --test test/` 会因 spawn EPERM 失败）。
- 结束时更新 PROGRESS + NEXT-SESSION 并提交，然后问用户下一场做什么。
```

## 下一场的备选

- **B. 切换默认到 Node**：验收通过后的收尾（删 Python、挪 static、改启动脚本与 README）。
- **C. M2 收尾**：主题预设、淡出行为、日语文案校对。
- **D. M3 延迟与稳定**：埋点、30 分钟长跑、断线重连。

## 交接提醒

- Node 版 exe 首次运行会在 exe 旁生成 `_app/`（解包目录）和 `api.toml`。
- Node 版打包：`node node\scripts\build-windows.mjs`（需要联网下载 postject 一次）。
- 两版共用 `livesub_local/static/`，改 UI 只要改一份。
