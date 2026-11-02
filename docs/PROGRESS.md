# 进度台账

> 状态：当前。每次会话结束更新；没有证据的条目标「未验」，不要写成完成。
> 最后更新：2026-11-02（第 1 场）

## 里程碑

| 里程碑 | 状态 | 说明 |
|---|---|---|
| M0 工程基座 | **已完成** | 仓库、配置模板、工作流文档、可启动服务、28 个离线测试 |
| M0.5 单文件 exe | **已完成（真机桌面未验）** | `dist\LiveSubLocal.exe` 已打包并跑通 HTTP/WS |
| M1 最小闭环 | **进行中** | 链路已实现；真机 Chrome 语音、真千问 Key、OBS 渲染未验 |
| M2 显示与 OBS 打磨 | 未开始 | 现有渲染是简化版；主题/样式热更新没做 |
| M3 稳定性与延迟 | 未开始 | 没有延迟埋点、没有长跑验证 |
| M4 上手体验 | 部分 | 有 exe / install / start，Key 校验提示还没做 |
| M5 可选增强 | 未开始 | 多目标语言、术语表、历史导出 |

## 第 1 场（2026-11-02）

### 完成

- 建仓库骨架：`AGENTS.md`、`README.md`、`docs/`（计划/进度/下一场/架构/决策/参考笔记）、
  `config.example.toml`、`api.example.toml`、`.gitignore`。
- 实现 `livesub_local/`：
  - `config.py`：读 `config.toml` + `api.toml`，校验语言/条数/端口，支持 UTF-8 BOM、frozen 路径。
  - `mt.py`：千问 MT 适配器（请求形状与参考 `qwen_mt_http.py` 一致）+ `mock` 适配器。
  - `hub.py`：会话、字幕滚动窗口、串行翻译队列、viewer 快照广播。
  - `server.py`：`/studio`、`/view`、`/api/health`、`/api/display`、`/v1/text`、`/v1/view`。
  - `static/studio.html`：**日语**控制台；Chrome Web Speech 识别 + 切句（14 字 / 800ms 停顿 / 2.5s 上限）；
    翻译方向固定 **日本語 → 中文**；底部加「OBS 字幕の見た目を変える（AI 用プロンプト）」栏（一键复制）。
  - `static/view.html`：最近 N 对字幕、字号/描边/位置/淡入淡出/自动淡出。
- `run.py`、`start.bat`、`install.bat`、`build_exe.bat`。
- 打包单文件 exe（PyInstaller，`--runtime-tmpdir .`），并实测启动。
- 28 个离线测试（配置、翻译、状态机、HTTP/WS）。

### 证据

```
$ python -m unittest discover -s tests
Ran 28 tests in 0.628s
OK
```

源码方式启动 + WebSocket 冒烟（`.tmp/ws_probe.py`，未入库）：

```
health 200 {'ok': True, 'engine': 'mock', ...}
studio 200 True
ready ready engine= mock
translation ［mock·zh］こんにちは、今日はいい天気ですね
SMOKE OK
```

exe 冒烟（干净文件夹 `.\tmp\exe-test2\`，只放了 exe + config.toml）：

```
首次运行自动生成 api.toml（775 字节，来自模板）
health: 200 {"ok":true,"engine":"mock",...}
studio: 200 len=12712 japanese=True
view-first idle
ready ready mock ja ['zh']
translation ［mock·zh］こんにちは、今日はいい天気ですね
EXE WS OK
```

### 未验证（必须下一场补）

- **真机 Chrome 语音识别**：`studio.html` 没有在浏览器里真正点过「開始」，切句参数是否合适未知。
- **真千问 Key**：只有 mock 与 `httpx.MockTransport` 离线测试，没有真实请求过 DashScope。
- **OBS 渲染**：`view.html` 没在 OBS 浏览器源里看过；字体/描边/透明背景/自定义 CSS 的效果都未验。
- **exe 双击 + 自动开浏览器**：命令行启动时 `open_browser=false`，没有验证「双击后浏览器自动弹出」。
- 控制台的日语文案没有母语者校对。

### 已知问题

- 单文件 exe 解压到自身目录，所以 exe 必须放在**可写**文件夹（别放 `C:\Program Files`）。
- 单文件启动要解压，冷启动约 1–2 秒。
- `/api/display` 只在页面加载时取一次：改字号/条数后要刷新 `/view`。
- 没有延迟埋点（A 识别定稿 → B 翻译返回 → C 显示）。
- 本会话的沙箱禁止写系统 Temp，pip/pyinstaller/exe 都要用「完整权限」跑；这是环境问题，不是项目问题。
- 本会话的沙箱还禁止写 `.git`（`index.lock: Permission denied`），所以 `git add/commit` 也用了「完整权限」；
  正常桌面环境不会这样。首次提交：`2325866`，27 个文件。

### 下一步候选（等用户选）

- A. 真机 M1 验收：双击 exe、填真 Key、Chrome 说话、OBS 看效果，记录实际延迟与切句问题。
- B. M2 显示打磨：2–6 对、位置、主题、样式热更新（不刷新 OBS）。
- C. M3 延迟与稳定性：埋点、长跑、断线重连。
