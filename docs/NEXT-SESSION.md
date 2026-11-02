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
收文字 → 千问 qwen-mt-flash 翻译 → /view 给 OBS 显示。没有账号/支付/数据库/部署。
控制台（/studio）是日语、Apple 风格，翻译方向固定 日本語 → 中文，可在控制台切换
千问区域 cn（北京）/ intl（新加坡）。

现状（2026-11-02 第 1 场结束）：
- 39 个离线测试通过；源码方式 + 单文件 exe 都做过 HTTP/WS 冒烟（mock 引擎）。
- dist\LiveSubLocal.exe 已打包（PyInstaller，--runtime-tmpdir .）。
- 控制台有：麦克风选择 + 输入增益 + 实时电平表、14 项字幕样式（改完实时生效、存 settings.json）、
  OBS URL、千问区域切换 + 接続テスト、OBS カスタム CSS 用プロンプト。
- 未验：真机 Chrome 语音识别与切句、真实千问 Key（cn/intl 都没试）、OBS 渲染、
  exe 双击是否真的自动弹出浏览器、exe 控制台日文字体。

本次目标（M1 真机验收）：
1. 让用户双击 dist\LiveSubLocal.exe，确认浏览器是否自动打开 /studio（这是上次没验的一条）。
2. 让用户自己把千问 Key 填进 exe 旁边的 api.toml（不要索取 Key、不要读 Key），
   重启后在控制台「翻訳エンジン」里点「接続テスト」，确认 cn 或 intl 哪个能通。
3. 让用户在 Chrome 里点「字幕を開始」，说 3 句日语，同时打开 /view 观察。
4. 记录：每句从定稿到译文出现的实际耗时、切句是否碎、有没有丢句/串句/串语言。
5. 在 OBS 浏览器源（1920x1080、透明）里看字幕位置/字号/描边；试一下控制台样式面板能否实时生效。
6. 发现的问题当场修；修不了写进 docs/PROGRESS.md 的「已知问题」。

验收标准：
- 3 句日语都出中文，单句定稿→显示 ≤ 1.5 秒（用户实测，不是估算）。
- 中间不出现整场中断；某一句失败不影响下一句。
- 样式面板改动在 /view 上立刻可见，不用刷新 OBS。
- 把实测数字写进 PROGRESS，没测到的写「未验」。

限制：
- 不要 push；提交用 GitHub Desktop 自带的 git：
  %LOCALAPPDATA%\GitHubDesktop\app-3.6.7\resources\app\git\cmd\git.exe
- 不要引入账号/支付/数据库/部署；不要改参考项目。
- 界面、配置模板、终端输出一律日语；README 是日语。docs/ 内部工程记录可用中文。
- 本会话沙箱禁止写系统 Temp 和 .git：pip / pyinstaller / 运行 exe / commit 需要「完整权限」。
- 结束时更新 PROGRESS + NEXT-SESSION 并提交，然后问用户下一场做什么。
```

## 下一场的备选（用户回答后替换上方「本次目标」）

- **B. M2 收尾**：主题预设、淡出/常显行为、日语文案校对、空状态与错误提示。
- **C. M3 延迟与稳定性**：埋点（定稿/请求/返回/推送/显示）、30 分钟长跑、断线重连、内存有界。

## 交接提醒

- 真机验收需要用户配合开麦；不要替用户点浏览器，也不要索取 Key。
- exe 必须放在可写目录：它会解压运行时到自身所在文件夹。
- 配信中不能切换千问区域（服务端 409）；验收时先停再切。
