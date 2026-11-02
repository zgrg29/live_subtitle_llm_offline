# 进度台账

> 状态：当前。每次会话结束更新；没有证据的条目标「未验」，不要写成完成。
> 最后更新：2026-11-02（第 1 场，续）

## 里程碑

| 里程碑 | 状态 | 说明 |
|---|---|---|
| M0 工程基座 | **已完成** | 仓库、配置模板、工作流文档、可启动服务、39 个离线测试 |
| M0.5 单文件 exe | **已完成（双击自动开浏览器未由人确认）** | `dist\LiveSubLocal.exe` 已打包并跑通 HTTP/WS |
| M1 最小闭环 | **进行中** | 链路已实现；真机 Chrome 语音、真千问 Key、OBS 渲染未验 |
| M2 显示与 OBS 打磨 | **进行中** | Apple 风格控制台 + 14 项样式 + 实时生效已做；主题预设/自动消失细节未打磨 |
| M3 稳定性与延迟 | 未开始 | 没有延迟埋点、没有长跑验证 |
| M4 上手体验 | 部分 | exe / install / start 都有；Key 缺失提示已有，但没有「保存 Key」表单 |
| M5 可选增强 | 未开始 | 多目标语言、术语表、历史导出 |

## 第 1 场（2026-11-02）

### 完成

**工程与链路**
- 仓库骨架：`AGENTS.md`、`README.md`（日语）、`docs/`、`config.example.toml`、`api.example.toml`、`.gitignore`。
- `livesub_local/`：`config.py`（config.toml + api.toml，支持 BOM、frozen 路径）、`mt.py`
  （千问 MT + mock）、`hub.py`（会话/滚动窗口/串行翻译队列/广播）、`server.py`（HTTP + 两个 WS）。
- 控制台是**日语**，翻译方向固定 **日本語 → 中文**。
- 单文件 exe：PyInstaller `--onefile --console --runtime-tmpdir .`，首次运行在 exe 旁生成配置。

**控制台改版（对齐参考项目的 Apple 风格）**
- `static/ui.css`：从参考 `hosted-ui.css` 精简的 Apple 设计系统（明/暗/跟随系统、卡片、胶囊按钮、
  表单、电平表），控制台顶部有主题切换。
- `static/subtitle.css` + `static/style.js`：字幕渲染共享层，`/studio` 预览与 `/view` 用同一套 CSS 变量。
- 字幕样式 14 项（字体、原/译文字号与颜色、描边、背景色与不透明度、位置、句数 2–6、
  排列顺序、边距、行距、保留秒数），改完**立刻**推到 `/view`，OBS 不用刷新；
  样式存 `settings.json`，重启后保留。**默认显示 2 对**（原文+译文算 1 对），
  **默认顺序为「新句在下、下往上流」**。
- 麦克风：设备选择、输入增益、实时电平表（dBFS，Web Audio + AnalyserNode）、
  **打开页面即自动开启**、「発話しきい値」滑块（-60〜-10 dBFS，默认 -40，电平表上画阈值线，
  超过显示「発話中」）。阈值只影响表上的判断，不改变 Chrome 的识别时机。
- 语言：识别/译文语言下拉，列表是 **Qwen MT ∩ Chrome Web Speech** 的 25 种语言，
  默认 日本語 → 中文；通过 WebSocket 查询参数按会话生效，选择存 localStorage。
- 控制台界面支持 **日本語 / 中文 / English** 三语切换（`I18N` 字典 + `data-i18n`），默认日语，
  选择存 localStorage；切换后状态行、引擎状态、单位等动态文本一起重渲染。
- 控制台底部保留「OBS 自定义 CSS 用 AI 提示词」，已改写成本页真实 DOM 与变量。

**千问区域切换**
- 控制台「翻訳エンジン」卡片可选 `cn`（中国大陆/北京）与 `intl`（海外/新加坡），
  有「接続テスト」按钮；配信中禁止切换（服务端返回 409）；选择存 `settings.json`。

**终端与配置的语言**
- `run.py` 启动时的所有输出改为日语，并 `chcp 65001` + `sys.stdout.reconfigure(utf-8)`。
- `start.bat` / `install.bat` / `build_exe.bat` / `config.example.toml` / `api.example.toml` 全部日语。
- **浏览器自动打开改为「探测端口 → `rundll32 url.dll,FileProtocolHandler` → `os.startfile`
  → `cmd /c start`」多级兜底**，并打印实际用了哪一种（参考同机 `D:\哔哩哔哩OBS礼物特效`
  的 `openPanel()` 做法，见 DECISIONS D-015）。控制台还会打印 `open_browser` 的取值和配置文件路径。

### 证据

```
$ python -m unittest discover -s tests
Ran 39 tests in 1.081s
OK
```

源码方式启动（`python -u run.py`，端口 8810）控制台输出：

```
[情報] Qwen の API Key が読めません（D:\live_subtitle_llm_offline\api.toml）。
       mock モードで起動します。訳文はダミーです。
============================================================
  LiveSub Local   http://127.0.0.1:8810/studio
  OBS ブラウザ    http://127.0.0.1:8810/view
  翻訳エンジン    mock（cn）
  停止するには、この画面で Ctrl+C を押します。
============================================================
```

新 UI 的 HTTP 冒烟（8805）：

```
/studio -> 200 (24728 bytes)  japanese title: True / meter: True / style form: True
/static/ui.css -> 200 (12286) /static/style.js -> 200 (1889) /static/subtitle.css -> 200 (930)
POST /api/display {"target_size":88,"pairs":9} -> 200, 夹到 pairs=6, position=top
GET  /v1/view 第一帧 display.target_size = 88（说明样式随快照下发）
字幕：［mock·zh］こんばんは
```

exe 冒烟（`dist\LiveSubLocal.exe`，8808）：

```
/api/health -> {"ok":true,"engine":"mock","region":"cn",...}
/api/engine -> cn / intl 两个 endpoint 都在
POST /api/engine {"region":"intl"} -> region=intl, endpoint=dashscope-intl...
POST /api/engine/test -> {"ok":true,"engine":"mock","sample":"［mock·zh］こんにちは"}
重启后 region 仍是 intl（settings.json 生效）
```

### 未验证（必须下一场补）

- **真机 Chrome 点击「字幕を開始」并说话**：切句参数、识别质量、真实延迟都没验。
- **真千问 Key 的翻译**：只有 mock 与 httpx.MockTransport 离线测试，未真实请求 DashScope；
  `cn` / `intl` 两个区域都没用真 Key 试过。
- **OBS 渲染**：`/view` 没在 OBS 浏览器源里看过；字体、描边、背景、自定义 CSS 都未验。
- **exe 双击自动开浏览器**：改成 rundll32 后，源码方式实测打印
  `[情報] ブラウザを開きました（rundll32）: http://127.0.0.1:8813/studio`；
  exe 里同一条代码路径也执行了（服务能起来），但**窗口是否真的弹出仍需要用户肉眼确认一次**。
- **exe 控制台的日文显示**：源码模式已确认；exe 里没有截到输出（重定向时被缓冲），
  字体是否支持日文取决于用户机器的控制台字体。
- 控制台的日语文案没有母语者校对。

### 已知问题

- 单文件 exe 解压到自身目录，必须放在可写文件夹（别放 `C:\Program Files`）；冷启动 1–2 秒。
- 配信中不能切换区域（会返回 409），需要先停止。
- `/view` 的 `clear_after_ms` 淡出后不会自动清空 DOM，只是透明；刷新或新句到来即恢复。
- 本会话沙箱禁止写系统 Temp 与 `.git`，pip / pyinstaller / exe / commit 都需要「完整权限」；
  这是环境限制，不是项目问题。

### 下一步候选（等用户选）

- A. 真机 M1 验收：双击 exe、填真 Key、Chrome 说话、OBS 看效果，记录实际延迟与切句问题。
- B. M2 收尾：主题预设、字幕淡出行为、界面文案校对。
- C. M3 延迟与稳定性：埋点、长跑、断线重连。

## 已移除：Node.js 版（2026-11-02）

Node 版服务端曾在这里并行实现过（`node/`，含 30 个 node:test 用例与 SEA 打包脚本），
因使用体验不如 Python 版，已整体移到 **`js` 分支**（`git switch js` 可查看）。
`main` 只保留 Python 实现。

## 发布：v0.1.0（2026-11-02）

- 发布说明：[docs/releases/v0.1.0.md](releases/v0.1.0.md)（日语，GitHub Release 正文直接用这份）
- 标题：LiveSub Local v0.1.0
- 标签：v0.1.0（annotated）
- 产物：dist\LiveSubLocal.exe（16,456,972 字节）
  SHA256 E5EE5C143715AB52CFCF71F234412F6DFFF76DF22C142F440873EF8D172C9033
- dist\RELEASE_NOTES.md / RELEASE_TAG.txt / RELEASE_TITLE.txt 是给发布流程用的副本（dist 不入库）。