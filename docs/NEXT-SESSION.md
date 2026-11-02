# 下一场对话提示词

> 状态：当前（每场结束重写，下一场可直接整段粘贴）
> 生成时间：2026-11-02
> 默认目标：**真机验收（Python 版）**

## 直接复制下面整段给新对话

```
继续 D:\live_subtitle_llm_offline 项目（LiveSub Local：本机实时字幕，日本語 → 中文）。

开工前先读：AGENTS.md、docs/PROGRESS.md、docs/NEXT-SESSION.md、docs/ARCHITECTURE.md。
参考项目 D:\live_subtitle_llm 只读，别改。

背景：把服务器版 LiveSub 的核心链路做成单机版；浏览器 Web Speech 识别 → 本机 FastAPI
→ 千问 qwen-mt-flash 翻译 → /view 给 OBS 显示。控制台是 Apple 风格、三语界面（日中英），
可切换千问区域（cn/intl）、25 种识别/译文语言、14 项字幕样式（实时生效）。

现状（2026-11-02）：
- main 只有 Python 版（livesub_local/），41 个 unittest 通过；exe 在 dist/LiveSubLocal.exe（16 MB）。
- 浏览器启动已改为 Chrome/Edge --new-window（DECISIONS D-020）。
- Node.js 版在 js 分支（不要合并回 main）。
- 未验：真机 Chrome 语音 + 真千问 Key + OBS 渲染。

本次目标（按顺序）：
1. 让用户双击 dist\LiveSubLocal.exe，确认会弹出一个新的 Chrome 窗口到 http://127.0.0.1:8765/studio。
   如果没弹，看控制台那行「ブラウザを開きました（…）」括号里写的是什么，再排查。
2. 让用户自己把千问 Key 填进 exe 旁边的 api.toml（不要索取 Key），重启后点「接続テスト」，
   确认 cn 或 intl 哪个能通。
3. 让用户在 Chrome 里点「字幕を開始」，说 3 句日语，同时打开 /view 观察。
4. 记录每句定稿→显示的实际耗时、切句是否碎、有没有丢句/串句；写进 PROGRESS。
5. 在 OBS 浏览器源（1920x1080、透明）里看字幕位置/字号/描边，试一下控制台样式面板是否实时生效。
6. 发现的问题当场修；修不了写进 PROGRESS 的「已知问题」。

验收标准：
- 3 句日语都出中文，单句定稿→显示 ≤ 1.5 秒（用户实测）。
- 样式面板改动在 /view 立刻可见，不用刷新 OBS。
- 把实测数字写进 PROGRESS，没测到的写「未验」。

限制：
- 不要 push；提交用 GitHub Desktop 自带的 git（`%LOCALAPPDATA%\GitHubDesktop\app-*\resources\app\git\cmd\git.exe`）。
- 不要动 js 分支，也不要把 Node 代码加回 main。
- 界面/配置/终端输出一律日语；README 日语；docs/ 用中文。
- 本会话沙箱：写 .git、系统 Temp 都被限制；git/pip/打包/跑 exe 需要「完整权限」。
- 结束时更新 PROGRESS + NEXT-SESSION 并提交，然后问用户下一场做什么。
```

## 下一场的备选

- **B. M2 收尾**：主题预设（几套现成样式）、淡出/常显行为、日语文案校对。
- **C. M3 延迟与稳定**：埋点（定稿/请求/返回/推送/显示）、30 分钟长跑、断线重连。
- **D. 打包与分发**：给 exe 加图标、版本信息、首次运行向导。

## 交接提醒

- exe 必须放在可写目录（会解压 `_MEIxxxx` 到自身目录）。
- 控制台的样式存在 `settings.json`（与 exe 同目录），删掉即恢复 config.toml 的默认值。
- 配信中不能切换千问区域（服务端 409）。
