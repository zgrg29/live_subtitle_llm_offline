# 下一场对话提示词

> 状态：当前（每场结束重写，下一场可直接整段粘贴）
> 生成时间：2026-11-02，第 1 场结束
> 默认目标：**M1 真机验收**（用户若选了别的，先把下面「本次目标」改掉再开始）

## 直接复制下面整段给新对话

```
继续 D:\live_subtitle_llm_offline 项目（LiveSub Local：本机实时字幕，日本語 → 中文）。

开工前先读：AGENTS.md、docs/PROGRESS.md、docs/NEXT-SESSION.md、docs/ARCHITECTURE.md。
参考项目 D:\live_subtitle_llm 只读，别改。

背景：把服务器版 LiveSub 的核心链路做成单机版；浏览器 Web Speech 识别 → 本机 FastAPI
收文字 → 千问 qwen-mt-flash 翻译 → /view 页给 OBS 显示。没有账号/支付/数据库/部署。
控制台界面是日语，翻译方向固定 日本語 → 中文。

现状（2026-11-02 第 1 场）：
- 源码链路完成：livesub_local/{config,mt,hub,server}.py + static/{studio,view}.html。
- 28 个离线测试通过；源码方式 + 单文件 exe 都做过 HTTP/WS 冒烟（mock 引擎）。
- dist\LiveSubLocal.exe 已打包（PyInstaller，--runtime-tmpdir .），能启动、能出 mock 译文。
- 控制台底部已有「OBS カスタム CSS 用プロンプト」栏。
- 未验：真机 Chrome 语音识别与切句、真实千问 Key、OBS 渲染、双击 exe 自动开浏览器。

本次目标（M1 真机验收）：
1. 让用户双击 dist\LiveSubLocal.exe（或在源码目录跑 start.bat），确认浏览器自动打开控制台。
2. 让用户自己把千问 Key 填进 exe 旁边的 api.toml（不要索取 Key、不要读 Key），重启程序。
3. 让用户在 Chrome 里点「開始」，说 3 句日语，同时打开 /view 观察。
4. 记录：每句从定稿到译文出现的实际耗时、切句是否碎、有没有丢句/串句/串语言。
5. 顺带确认 OBS 浏览器源里字幕的位置/字号/描边是否可读（1920x1080）。
6. 发现的问题当场修；修不了写进 docs/PROGRESS.md 的「已知问题」。

验收标准：
- 3 句日语都出中文，单句定稿→显示 ≤ 1.5 秒（用户实测，不是估算）。
- 中间不出现整场中断；某一句失败不影响下一句。
- 把实测数字写进 PROGRESS，没测到的写「未验」。

限制：
- 不要 push；提交用 GitHub Desktop 自带的 git：
  %LOCALAPPDATA%\GitHubDesktop\app-3.6.7\resources\app\git\cmd\git.exe
- 不要引入账号/支付/数据库/部署；不要改参考项目。
- 本会话沙箱禁止写系统 Temp：pip / pyinstaller / 运行 exe 需要「完整权限」，这是环境问题。
- 结束时更新 PROGRESS + NEXT-SESSION 并提交，然后问用户下一场做什么。
```

## 下一场的备选（用户回答后替换上方「本次目标」）

- **B. M2 显示打磨**：2–6 对可配、新句在上/在下、主题预设、样式热更新（不刷新 OBS）、
  按字数延长显示时间。参考 `docs/reference/VIEWER-SPEC.md`。
- **C. M3 延迟与稳定性**：埋点（定稿/请求/返回/推送/显示）、30 分钟长跑、断线重连、内存有界。

## 交接提醒

- 真机验收需要用户配合开麦；不要替用户点浏览器，也不要索取 Key。
- exe 必须放在可写目录：它会解压运行时到自身所在文件夹。
