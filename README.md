# LiveSub Local

在自己电脑上跑的实时字幕：对着麦克风说日语，浏览器和 OBS 里立刻出现「日语原文 + 中文译文」。

- 语音识别用 **Chrome / Edge 自带的 Web Speech**（音频不出本机，只有文字发给千问）
- 翻译用 **千问 `qwen-mt-flash`**，每句只翻一次，方向固定 **日本語 → 中文**
- 没有账号、登录、支付、额度、数据库、后台、服务器 —— 只监听 `127.0.0.1`
- 控制台界面是**日语**（面向日本主播），提示词与文案都按日语写

> 「本地」指的是**不需要服务器**，不是完全离线：识别依赖 Chrome 自带的在线服务，翻译依赖千问 API。

## 需要什么

1. Windows 电脑
2. Chrome 或 Edge（Firefox / Safari 不支持语音识别）
3. 一个千问 API Key：[阿里云百炼控制台](https://bailian.console.aliyun.com/) → API-KEY

## 方式 A：直接用 exe（推荐）

`dist\LiveSubLocal.exe` 是打包好的单文件程序，不用装 Python。

1. 把 `LiveSubLocal.exe` 拷到任意文件夹（例如 `D:\LiveSub\`），双击运行
2. 第一次运行会在 exe 旁边生成 `config.toml` 和 `api.toml`
3. 用记事本打开 `api.toml`，把 `qwen.api_key` 填成自己的 Key，保存
4. 关掉黑色窗口，再双击一次 `LiveSubLocal.exe`
5. 浏览器会自动打开 `http://127.0.0.1:8765/studio`，点「開始」开始说话

OBS → 来源 → **浏览器** → 地址填 `http://127.0.0.1:8765/view`，宽 1920 高 1080，背景透明。

> 单文件 exe 启动时会把运行时解压到**自己所在的文件夹**（`_MEIxxxx`），退出时自动删除。
> 所以 exe 要放在一个可写的文件夹里，不要放在 `C:\Program Files`。

## 方式 B：从源码运行（改代码时用）

需要 Python 3.11+（安装时勾选 “Add python.exe to PATH”）。

```bat
:: 第一次：安装依赖
install.bat
:: 启动
start.bat
```

`start.bat` 会自动打开浏览器；改代码后重启它即可。

## 打包 exe

```bat
build_exe.bat
```

产物在 `dist\LiveSubLocal.exe`（约 16 MB）。打包脚本已经带上 `--runtime-tmpdir .`，
避免少数机器上系统 Temp 被安全软件锁住导致启动失败。

## 配置文件

| 文件 | 内容 | 会提交到 git 吗 |
|---|---|---|
| `api.toml` | **千问 API Key**、endpoint、model | ❌ 不会（已在 `.gitignore`） |
| `api.example.toml` | 上面这个文件的模板，`api_key` 为空 | ✅ 会 |
| `config.toml` | 端口、字幕条数、字号、位置 | ❌ 不会 |
| `config.example.toml` | 上面这个文件的模板 | ✅ 会 |

`api.toml` 里的 Key 不要截图、不要发到聊天或群里、不要上传网盘。

## 目录

```
LiveSubLocal.exe            打包产物（dist/ 里，不入库）
build_exe.bat               打包脚本
start.bat / install.bat     源码方式启动 / 安装依赖
run.py                      启动入口
config.example.toml         界面/字幕配置模板
api.example.toml            千问 API 配置模板
livesub_local/
  config.py                 读配置、校验（支持 exe 模式）
  mt.py                     千问翻译 + mock
  hub.py                    字幕状态、翻译队列、广播
  server.py                 HTTP / WebSocket
  static/studio.html        控制台（日语界面，语音识别在这里）
  static/view.html          OBS 显示页
tests/                      离线测试（不联网、不用浏览器）
docs/                       规划、进度、下一场提示词、架构、决策
```

## 开发

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m unittest discover -s tests -v
```

强制用假翻译跑通界面（不需要 Key）：把 `config.toml` 里 `[subtitle].engine` 设成 `"mock"`。
mock 模式的译文长这样：`［mock·zh］原文`，一眼能看出不是真翻译。

## 控制台里的自定义 CSS 提示词

控制台最下面有一栏「OBS 字幕の見た目を変える（AI 用プロンプト）」：把里面的提示词粘给 AI，
它会按本页的 DOM 结构返回一段 CSS，再粘进 OBS 浏览器源的「自定义 CSS」栏，就能改字幕外观。
提示词是日语写的，和界面语言一致。

## 常见问题

**只支持 Chrome / Edge？** 是。识别用的是 `webkitSpeechRecognition`，Firefox/Safari 没有。

**没有字幕出来？** 看控制台的状态行：没连上服务、麦克风被拒、识别出错都会写在那里；
再确认黑色窗口没有关掉。

**字幕是 `［mock·zh］…`？** 说明没读到 `api.toml` 里的 Key，或者 Key 为空。填好 Key 后重启程序。

**端口被占用？** 改 `config.toml` 里的 `[server].port`，比如 8790。

**OBS 里是白底/黑底？** OBS 浏览器源默认背景透明；如果用了自定义 CSS，把 body 背景设成透明。

## 已知限制

- 单机单人：同一时间只有一个控制台会话
- 翻译方向固定 日本語 → 中文
- 没有字幕历史、没有导出（M5 可加）
- 主题只有一套默认样式（M2 再扩）

## 许可

MIT
