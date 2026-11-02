# OBS 字幕显示层技术参考（参考项目 `D:\live_subtitle_llm`）

> **证据基准**：参考项目 HEAD `cea2702`（2026-11-01），读取日期 2026-11-02。
> 参考项目**只读**，本笔记未修改其任何文件。
> **标记约定**：
> - 【码】= 直接读源码确认（静态事实，行号对应当前 HEAD）；
> - 【推】= 由源码执行路径推导、未运行验证；
> - 【未验】= 无法确认，见第 6 节。
> **结论一句话**：这套显示层是「全量快照 + 最后一次覆盖渲染」模型 —— 服务端每有字幕事件就推一份完整 `sentences` 列表（最多 100 句），页面只取最后一句 + 若干历史对重画；样式偏好搭同一条消息下发，因此改样式不需要刷新 OBS。

---

## 0. 页面是怎么拼起来的（不理解这个会看不懂作用域）

- 参考实现不是独立 HTML，而是 `hosted_view.py:10-22` 的一个模板字符串：`<main aria-live="polite">` + 隐藏的 `#livesub-fault` + 一个 `<script>` 占位。
- `render_view()`（`hosted_view.py:29-33`）把三段脚本**按顺序拼进同一个 `<script>`**：`hosted-overlay.js` → `hosted-paint.js` → `hosted-viewer.js`。
  - 因此三者共享同一词法作用域：`root`、`clearAfter`、`timer`、`last`、`socket` 互相可见。
  - 这是 `hosted-overlay.js:37-40` 能直接 `clearTimeout(timer)` 的原因 —— `timer` 是 `hosted-viewer.js:28` 声明的变量。【码】
- 模板自带兜底 CSS（`hosted_view.py:12-19`），**首条快照到达并执行 `applyOverlay()` 之前**画面用的就是它：
  `body{background:transparent;color:white;font:bold 38px sans-serif;text-shadow:0 2px 4px black}`
  `main{position:fixed;bottom:5%;width:100%}`、`.source{font-size:26px}`、`p{margin:8px}`。
- `root = document.querySelector('main')`（`hosted-viewer.js:22`）。整页背景透明（`html`/`body` 都是 `transparent`），供 OBS 浏览器源叠加。【码】
- 页面由 `GET /view/live`（账号级稳定地址）或 `GET /view/{sid}`（旧式单场地址）返回；token 在 URL 的 `#` 片段里（`hosted.py:1335, 1346`）。`?surface=preview` 只影响提示条/错误条的展示时长与上报的 `surface` 标签，不影响字幕画面；`?target=zh` 可只渲染某个目标语言。【码】

---

## 1. 浏览器端收到的数据结构

### 1.1 传输通道

- **只有一条 WebSocket**：`endpoint()`（`hosted-viewer.js:242-246`）拼出 `ws(s)://<host>/v1/view/live`（或 `/v1/view/{sid}`）。页面本身不走轮询、不 `fetch` 任何状态接口。【码】
- 连接后的第一帧是鉴权（`hosted-viewer.js:295-302`）：
  `{"type":"auth","token":location.hash.slice(1),"surface":"obs"|"preview"}`；老客户端退化为裸 token 字符串，服务端两种都收（`hosted.py:1862-1873`）。
- 服务端 → 客户端**只有两种**消息：`type:"snapshot"` 与 `type:"control"`。其它 `type` 在 `handle()` 里直接 `return`（`hosted-viewer.js:215`）。【码】

### 1.2 snapshot 载荷（`hosted.py:1933-1937`）

```jsonc
{
  "type": "snapshot",
  "mode": "cloud",
  "session_id": "<run.sid>",
  "targets": ["zh"],                  // 该场的目标语言，决定渲染哪些译文行
  "language_catalog": [ ... ],        // 语言下拉目录；viewer 不使用
  "overlay": { ...16 个字段... },      // 样式偏好，见第 3 节
  "sentences": [
    { "source": {Event}, "translations": [ {Event}, ... ] }
  ],
  "seq": 42                           // 每条 +1，每连接从 0 开始
}
```

- `sentences` 是 `[asdict(SentenceSnapshot)]`；`SentenceSnapshot` 只有两个字段：`source` 与 `translations`（`subtitle_state.py:7-10`）。JSON 化后元组变数组。【码】
- 单条 `Event` 的完整字段（`subtitle_protocol.py:7-25`）：
  `session_id, sentence_id, revision, source_revision, source_language, target_language, kind(source|translation|error), status(partial|final|error), text, start_ms, end_ms, emitted_ms, mode, route_generation, usage_owner, fallback_reason, error_code, schema_version=1`。
  viewer 实际只读：`source.{sentence_id, revision, text, status, source_language}`、`translations[].{target_language, text, status, revision}`。【码】
- **是全量快照，不是增量**：每次发送都取 `run.gateway.state.snapshot()` 的完整列表（`hosted.py:1922`），容量 100 句（`hosted.py:436`，`max_sentences=100, rolling=True`；超限淘汰最旧，`subtitle_gateway.py:101-107`）。
  → 因此**没有「从 seq N 补发」的协议**；重连的补齐成本就是一条消息。【码】

### 1.3 发送时机（决定"字幕何时出现"）

| # | 触发 | 位置 | 说明 |
|---|---|---|---|
| 1 | 任一字幕事件（source/translation，partial/final） | `subtitle_gateway.py:130-134` | 往每个订阅队列 `put` 新快照；队列 `maxsize=1`，满则丢旧 |
| 2 | 客户端发 `{"type":"sync"}` | `hosted.py:1752-1754`、`1920-1922` | 立即回一条当前快照 |
| 3 | 建立连接 | `subtitle_gateway.py:53-55` | `subscribe()` 先塞一条当前快照，不等事件 |
| 4 | 2 秒兜底 | `hosted.py:1915`（`asyncio.wait(..., timeout=2)`）+ `1922` | 超时未完成任务也发一条；**空闲时约每 2 s 一条相同快照** 【推】 |

- 每条消息 `seq += 1`，并记 `sent_at_by_seq[seq]` 供回执计算（`hosted.py:1947-1950`）。客户端把 `seq` 存进 `window.__livesubSeq`，再以**不可枚举属性** `__livesubSeq` 挂到最新句子上（`hosted-viewer.js:223-233`），避免影响去重 key。
- 队列只有 1 格意味着**突发时中间 revision 会被丢弃**，但不会丢状态（每帧都是全量）。【码】

### 1.4 client → server 的其它帧

| type | 频率 | 字段 | 位置 |
|---|---|---|---|
| `paint` | 每次成功渲染，双 `requestAnimationFrame` 后 | `sentence_id, source_revision, kind, revision, target_language, status, surface, hidden, receive_to_paint_ms, paint_epoch_ms, frame_ms, snapshot_seq` | `hosted-paint.js:23-30` |
| `beat` | 每 5 s | `visible, raf_age_ms, last_seq, ack_at, at` | `hosted-viewer.js:256-268` |
| `visibility` | `document.hidden` 变化时 | `hidden, at` | `hosted-viewer.js:358-363` |
| `client_error` | 出错时，同类 5 s 限流、最多 20 条 | `kind, message, surface, at` | `hosted-viewer.js:108-132` |

### 1.5 重连时如何补齐

`connect().onopen`（`hosted-viewer.js:295-310`）依次做四件事：

1. 发 `auth`（token 来自 `location.hash`，**不在** URL query 里）；
2. `last = ''` —— 清掉去重 key，保证下一条快照一定重绘（即使句子没变、即使刚才是同一画面）；
3. `syncNow()` → 服务端立刻回一条快照；
4. `startBeat()` 恢复心跳。

- 服务端在 `subscribe()` 时已经预置了一条快照（上面 1.3#3），所以即使 `sync` 丢了也有帧可画。
- 客户端**不缓存**任何状态：刷新页面等于从零，靠第一条快照重建。
- `/view/live`（稳定地址）额外行为：
  - 无会话时服务端**保持连接**最多 1800 s，每 2 s 发 `{"type":"control","code":"waiting"}`（`hosted.py:1832-1856`）；期间账号开新场，连接自动改挂到新 run（`hosted.py:1901-1906`）。
  - 会话结束/换场时发 `control: session_ended` 再以 **1008** 关闭；页面 3 s 后重连并挂到新场（`hosted-viewer.js:279`、`313-326`）。`link_invalid` 则 15 s 后再试（`279`）。
  - 旧式 `/view/{sid}` 走指数退避 1/2/4/8/15 s，第 8 次失败后 reload（`hosted-viewer.js:280-285`）。
- 关闭码语义：**所有**关闭都用 1008（`hosted.py:2010`），真正原因靠关闭前的 `control` 帧区分（`1998-2008`）；旧式地址在 1008 时直接显示"本场已结束或链接已失效"（`322-323`）。【码】

### 1.6 客户端处理管线

`handle(event)`（`hosted-viewer.js:208-240`）：

```
JSON.parse
 ├─ control → control()（waiting / session_ended / no_session / link_invalid）
 ├─ 有 overlay → applyOverlay(data.overlay)     // 先换样式
 ├─ normalize(data)                              // 只保留 source.text 是字符串的条目
 ├─ __livesubSeq / 把 seq 钉到最新句子
 ├─ window.__livesubData = data
 └─ render(performance.now(), false)             // 渲染最后一句
```

- `normalize()`（`181-196`）会把 `data.sentences` 原地替换成只含 `{source, translations}` 的数组；如果输入非空但全部不可用，抛 `snapshot has no usable sentence`，该帧被丢弃（已到达的旧画面保留）。
- 单帧失败被 `report()` 包住，不会影响后续消息；连续 5 条坏消息触发 reload（`116`），reload 有 60 s 冷却 + `sessionStorage` 记录（`331-343`）。

---

## 2. 渲染模型：显示几对、怎么配对、什么顺序

### 2.1 「对」的定义

- 这里的 **pair ≠ 两句字幕**。一个 pair = `sentences[i]` 里的「1 条 `source` + 每个 target 1 条 `translations`」。
- 所以 `history_pairs=6` 且有 2 个目标语言时，DOM 里最多 `6 × (1+2) = 18` 个 `<p>`。**没有任何总行数上限**（`max_lines` 在 hosted 里没被使用，见 3.4）。【码】

### 2.2 对数与取值

`window.__livesubRows()`（`hosted-viewer.js:394-430`，每次 render 调用一次，`163`）：

```js
const pairs = Math.max(2, Math.min(6, Math.round(Number(window.__livesubPairs) || 2))); // :399
const newestTop = window.__livesubOrder === 'top';                                      // :400
```

- 服务端把 `history_pairs` 限制为 `(2, 6)` 且必须是 `int`（`hosted.py:61`、`101-104`），前端再 clamp 一次兜底。
- 默认 2，即「当前句 + 上 1 句」。设置项文案：`显示句数（含当前句，最少 2 对）`（`hosted-studio.html:430-437`）。

### 2.3 历史句的挑选规则（容易踩坑）

```js
for (let i = list.length - 2; i >= 0 && history.length < pairs - 1; i--) {
  if ((list[i].translations || []).some(t => t.status === 'final')) history.unshift(list[i]);
}
```

- 从**倒数第二句**往前扫，只收「至少有一个目标语言已 final」的句子，取满 `pairs-1` 条为止（`403-405`）。
- 判据是 `some(...)`，不是「当前显示的 target 已 final」，也不是「相邻 N 条」。
  → 中间某句还没有 final 译文时，会**跳过它继续往前找**，屏幕上出现不连续的句对（例如显示 1、3，跳过 2）。【码】
- 当前句永远显示，哪怕还是 partial（`407`）。

### 2.4 排列顺序

```js
const groups = history.map(pair => ({pair, fresh: false}));  // 历史：旧 → 新
groups.push({pair: list.at(-1), fresh: true});               // 当前句追加在末尾
if (newestTop) groups.reverse();                             // :408
```

- 默认 `history_order='bottom'`：**新句在下**（DOM 末尾），旧句在上。
- `'top'`：整体反转，**新句在上**。
- 设置项：`studio.order.bottom` / `studio.order.top`（`hosted-studio.html:444-447`）。

### 2.5 行构造与 DOM 更新

每对按 `source` → `targets` 顺序生成行（`410-418`）：

| 行 | id | kind | 文本来源 | status |
|---|---|---|---|---|
| 原文 | `<sentence_id>-source` | `source` | `pair.source.text` | 当前句用真实 `status`，历史句强制 `'final'` |
| 译文 | `<sentence_id>-<lang>` | `translation` | `translation.find(...)`，条件：`target_language===code` 且（当前句或 `status==='final'`） | 当前句允许 partial；找不到时 `text:''`、`status:'partial'` |

- 历史句若某个 target 没有 final 译文 → **该 target 不建行**（`415`），原文行照建。
- `data.targets` 可被 URL `?target=xx` 过滤（`401`）；`targets` 为空时只剩原文行。
- DOM 复用（`419-429`）：按 `p.dataset.track === r.id` 找已有节点，改 `textContent`，不重建整棵树；多余节点删除（`429`）。副作用是避免闪烁，也保证 partial 更新时节点稳定。
- 其它属性：`p.lang = target_language || source_language`、`p.dir='auto'`、`className` 含 `source` / `draft`（`424-425`）。
- 文案：partial 时末尾追加 `" …"`（`426`）；空文本用 `\u00a0`（不换行空格）占位，保持行高不跳动。

### 2.6 去重与清屏的相互作用（重要）

- 去重 key = `JSON.stringify([session_id, newestSentence])`（`156-159`），句子没变就不重绘。
- 清屏定时器在**每次成功 render** 时重设（`161`、`166-170`），到点 `root.replaceChildren()`。
- **清屏不重置 `last`** → 清屏后同样的快照不会把字幕画回来，画面保持空白，直到句子内容/状态变化。【码】
- 但 `applyOverlay()` 里的 `window.__livesubRows()`（`hosted-overlay.js:36`）会无条件按 `__livesubData` 重建，绕过 `last`。也就是说：**自动清屏后，在设置页改任一外观项（下一次快照应用 overlay）会把最后一对字幕"复活"**。这是从调用路径推得的行为，未在浏览器实测。【推】
- 空列表或没有 `source` 时：清空 `main`（`146-150`），或保留上一帧（`152-155`）。

---

## 3. 显示样式参数全清单

### 3.1 参数表（默认值以 **hosted** 的 `default_preferences()` 为准，`hosted.py:78-84`）

| 字段 | 默认 | 校验 / 取值 | 页面落点 | 说明 |
|---|---|---|---|---|
| `bilingual` | `true` | bool | `--source-display: block\|none` | 关掉只隐藏原文行，DOM 与对数不变 |
| `font_family` | `"Microsoft YaHei", "Noto Sans SC", "PingFang SC", sans-serif` | 1–160 字符，字符集 `[\w\s,'".\-]+`（`\w` Unicode，可写中文字体名；**不允许括号**） | `root.style.fontFamily` | 字体必须在 OBS 所在机器可用（studio 提示 `hosted-studio.html:349-353`） |
| `zh_size` | `56` | int 12–140 | `root.style.fontSize = N+'px'` | 译文基准字号，`p` 继承 |
| `ja_size` | `30` | int 10–120 | `--ja-size` | 仅 `.source` |
| `zh_color` | `#FFFFFF` | `^#[0-9a-fA-F]{6}$` | `root.style.color` | |
| `ja_color` | `#B9C6D4` | 同上 | `--ja-color` | |
| `outline_color` | `#000000` | 同上 | `--outline-color` | `-webkit-text-stroke` 颜色 |
| `outline_width` | `5` | int 0–12 | `--outline-width` | 0 = 无描边 |
| `background_color` | `#000000` | 同上 | 转为 `rgba(r,g,b,a)` | 与下一项组合 |
| `background_alpha` | `0` | int 0–100 | alpha = 值/100 | 0 = 全透明 |
| `position` | `bottom` | `top` \| `bottom` | `root.style.top/bottom` | **没有 center** |
| `margin_percent` | `0` | int 0–45 | `top` 或 `bottom` 的百分比 | 距所贴边的距离；hosted 默认 0（`config.py:156` 是 8，被覆盖） |
| `line_gap` | `10` | int 0–40 | `--line-gap` | 每个 `p` 上下外边距，相邻折叠后 = 行距 |
| `clear_after_ms` | `5000` | int 0–30000 | 全局 `clearAfter` 定时器 | 0 = 不消失 |
| `history_pairs` | `2` | int 2–6 | `window.__livesubPairs` | **含当前句**的总对数 |
| `history_order` | `bottom` | `bottom` \| `top` | `window.__livesubOrder` | bottom = 新句在下 |

一份可直接照抄的默认值：

```json
{"bilingual":true,
 "font_family":"\"Microsoft YaHei\", \"Noto Sans SC\", \"PingFang SC\", sans-serif",
 "zh_size":56,"ja_size":30,
 "zh_color":"#FFFFFF","ja_color":"#B9C6D4",
 "outline_color":"#000000","outline_width":5,
 "background_color":"#000000","background_alpha":0,
 "position":"bottom","margin_percent":0,
 "line_gap":10,"clear_after_ms":5000,
 "history_pairs":2,"history_order":"bottom"}
```

### 3.2 不属于 hosted 调色板的字段（别照抄错了）

`OverlayConfig`（`config.py:144-163`）里还有三个**没有**暴露给 hosted 的字段：

| 字段 | 默认 | 状态 |
|---|---|---|
| `background` | `"transparent"` | 不在 `OVERLAY_FIELDS`（`hosted.py:55-57`），hosted 用 `background_color`+`background_alpha` 代替 |
| `max_lines` | `2` | 同上；hosted 只限「对数」不限「行数」 |
| `fade_ms` | `180` | 同上；**hosted 页面没有任何淡入/淡出**，只有本地版 `overlay/index.html` 用 `--fade` 做 `rise` 动画（`overlay/index.html:18, 59-69`） |

`merge_preferences` 会拒绝任何未在白名单里的键（`hosted.py:92-93`），所以这 3 个字段在服务器版里存不进去。

### 3.3 从服务端偏好到页面（链路 + 生效延迟）

```
studio 表单（id 与 input 类型见 hosted-studio.html:343-481）
  → readOverlay()  :746-756      numeric 数组 :621；clear_after_ms 秒×1000（:749）
  → queuePreferences() :1073-1079  300 ms debounce；onchange 立即 flush（:1245-1246）
  → POST /v1/preferences {overlay}  hosted.py:1450-1456
  → merge_preferences() 校验    hosted.py:87-119
  → 每账号一行 JSON 写入 trial_preferences  hosted.py:154-169
  → 每条 snapshot 带 overlay    hosted.py:1935（每条都重新读 DB）
  → applyOverlay(data.overlay)  hosted-viewer.js:216-219
  → CSS 变量 + 内联样式           hosted-overlay.js:11-41
```

- **生效延迟**：最多约 2 s（下一帧兜底快照），不需要刷新 OBS。
- viewer 从不 `GET /v1/preferences`；样式只随快照来。设置页自己回填表单（`populate()`，`hosted-studio.html:856-879`）时用的 `preferences` 来自 `GET /v1/preferences`（`:1267`）或 `/v1/status`（`:970`）。
- 预览 iframe：`src = viewURL.replace('#', '?surface=preview#')`（`730-731`），并且**同源直接调用** `iframe.contentWindow.applyOverlay(overlay)` 做未保存的即时预览（`782-785`），不是 postMessage。
- `readOverlay()` 以 `settings.overlay` 为底再覆盖表单值，所以 16 个键一个不少。
- **与本地设计的差异**：`docs/ARCHITECTURE.md:64, 84` 计划用 `GET /api/display` 单独取显示参数。参考实现是「每条快照都重发 overlay」，所以改样式最多 2 s 自动生效；若改走独立接口，保存后必须让 view 页主动重取（或由服务端在 WS 上补推一条 overlay 消息），否则 OBS 页要刷新才看到新样式。【推】

### 3.4 CSS 细节（照这个实现视觉效果才对）

```css
.livesub-subtitle{text-align:center;font-weight:700;box-sizing:border-box;overflow-wrap:anywhere}
.livesub-subtitle p{color:inherit;font-size:inherit;font-family:inherit;
  margin:var(--line-gap,10px) 0;                 /* 相邻折叠 → 行距 = line_gap */
  paint-order:stroke fill;
  -webkit-text-stroke:var(--outline-width,0px) var(--outline-color,#000);
  text-shadow:0 2px 4px #000}                    /* 固定，不可配 */
.livesub-subtitle .source{font-size:var(--ja-size,30px);color:var(--ja-color,#b9c6d4);
  display:var(--source-display,block)}
.livesub-subtitle p{min-height:1.3em;line-height:1.3}
.livesub-subtitle .draft{opacity:.72}
.livesub-subtitle:empty{background:transparent!important}
```
（`hosted-overlay.js:4-9`）

- 根节点：`fontFamily = font_family`（原样字符串）、`fontSize = zh_size+'px'`、`color = zh_color`（`13-15`）。
- 背景：颜色 hex 切片 `parseInt` → `rgba(r,g,b, alpha/100)`（`22-23`）；空节点时被 `:empty` 规则压成透明，避免清屏后留一块色块。
- 定位（仅 `fixed=true`，即 OBS/preview 页；studio 样式样例传 `false`）：
  `position:fixed; left:50%; right:auto; width:90%; transform:translateX(-50%)`；
  `top = position==='top' ? margin_percent+'%' : 'auto'`；
  `bottom = position==='bottom' ? margin_percent+'%' : 'auto'`（`24-29`）。
  → 左右各留 5% 固定，不可配；**没有 max-width、没有安全区、没有 center**。
- 描边用 `-webkit-text-stroke` + `paint-order:stroke fill`，对原文和译文同时生效；阴影恒为 `0 2px 4px #000`。
- 长文本靠 `overflow-wrap:anywhere` 硬换行，不截断、不省略；高度会一直长（`pairs × 行数` 无上限）。
- 坏颜色值会在 `applyOverlay` 里抛错 → `report('overlay')`，本帧样式不生效，但正文仍照常渲染（`216-219`）。

---

## 4. 时间与延迟

### 4.1 何时出现

- **没有客户端队列、没有入场动画、没有节流**：`handle()` 同步调用 `render()` 改 DOM（`141-179`）。服务端来一帧画一帧。
- partial 也会显示：ASR 草稿文本逐字更新，草稿译文（若开启 `drafts`）同样带 `draft` 半透明样式，文本尾加 `" …"`。
- 绘制回执用「双 `requestAnimationFrame`」标记回调时机，**不代表真实扫描/合成**（`hosted-paint.js:1-2, 42-45`）；`hidden` 时立即发并标 `hidden:true`（`37-40`）。

### 4.2 何时消失

- 唯一机制是 `clear_after_ms`：render 成功后 `setTimeout(清空 root, clearAfter)`（`hosted-viewer.js:166-170`）。
- 计时从「最后一次成功渲染」开始，每次重绘重置（`161`）；改设置导致值变化时也会按新值重启（`hosted-overlay.js:37-40`）。
- `0` = 永不消失（设置文案 `hosted-studio.html:465-472`）。
- **硬切，没有淡出**：到点直接 `replaceChildren()`。本地版才有 200 ms 淡出 + 180 ms 入场（`overlay/index.html:18, 59-69, 228-234`）。
- **不按字数延长**：本地版有 `1500 + 130ms/字`，上限 15 s（`overlay/index.html:216-225`）；hosted 没有这段逻辑。
- 页面隐藏时 `setTimeout` 仍会执行（隐藏只停 rAF，不停计时器）——这是浏览器通用行为，未在 OBS 里实测。

### 4.3 有没有排队 / 补齐

- 客户端：无队列，只画最新快照的最后一句。
- 服务端：订阅队列 `maxsize=1`，新快照覆盖旧快照（`subtitle_gateway.py:53-55, 131-134`）→ 慢客户端丢掉中间 revision，但不会错过「当前状态」。
- 历史句不靠客户端缓存，靠 `sentences` 列表本身；所以重连/刷新都能立刻还原最多 `pairs` 对。
- 会话容量 100 句，超出淘汰最旧（`hosted.py:436`、`subtitle_gateway.py:101-107`）。

### 4.4 静音 / 长时间无新句

1. 服务端仍每约 2 s 发兜底快照 → 客户端 `lastMessageAt` 持续刷新，12 s 静默看门狗不会误杀（`hosted-viewer.js:381-385`）。
2. 画面在最后一句之后 `clear_after_ms` 清空，之后相同快照被去重，**保持空白**，直到新句或新的 revision 到达。
3. 若 OBS 源被刷新：`last=''`，会立刻重绘快照里的最后一句并重新开始计时（`307`、`235`）。
4. 服务端 20 s 内既无 ack 又无 beat 记为 `view_stall`（`hosted.py:1951-1967`），只做诊断，不影响画面。

### 4.5 客户端看门狗（3 s 巡检，`hosted-viewer.js:373-388`）

| 条件 | 动作 |
|---|---|
| 可见但 >10 s 无 rAF | `report('raf_stall')` + `forceRefresh()` |
| >30 s 无 rAF | `maybeReload('raf_stall')`（60 s 冷却） |
| socket 打开但 >12 s 无消息 | 主动 `close()` 并重连 |
| 没有可用 socket | 立即重连 |
| 心跳 | 每 5 s 发 `beat`（`256-268`） |

### 4.6 `hosted_timing.py` 是做什么的（别把它当显示逻辑）

`hosted_timing.py` 只做**服务端诊断落库**，不参与「何时出现/消失」：

- `TimingLog.paint(sid, surface, value, sent_at)`（`96-124`）：接收页面回执，校验 `receive_to_paint_ms`、`paint_epoch_ms` 是有限数且 `0 ≤ delay ≤ 60000`（`101-104`）。
- 记录 `client_reported, kind, receive_to_paint_ms, paint_epoch_ms, server_sent_ms, server_ack_ms, publish_to_ack_upper_bound_ms`（`109-113`）。最后一项 = ack 时刻 − 发送时刻，**含网络与排队，是上界**。
- 按 `surface(preview|obs) × 语言` 存 `first / partial / final`（`117-122`）。
- `snapshot()` 里算的 `speech_start_to_zh_final` 等是整条链路的延迟指标（`126-165`），与字幕条渲染无关。
- 所以：**做本地版时这套可以整段不要**；要测延迟，用 `performance.now()` 在页面里打点即可。

---

## 5. 给本地单机版的简化建议

### 5.1 必须保留（照搬形状，能省很多返工）

1. **一条 WS + 全量快照**。哪怕本地只有一句话，也建议保持 `{type:'snapshot', sentences:[{source, translations}], targets, overlay, seq}` 的形状——重连、刷新、丢帧都自动对齐，不需要增量协议。
2. **订阅即发 + `sync` 立即回帧**。这是"刷新 OBS 后立刻有字"的关键，成本只有几行。
3. **渲染器四件套**：`pairs` clamp、`history_order`、去重 key（`session_id`+最新句）、clear timer。以及 partial 的 `" …"` + `.draft` 半透明。
4. **applyOverlay + CSS 变量**：样式与 DOM 结构解耦，改字号/颜色不动渲染代码。
5. **最简重连**：`onclose` 后 2–3 s 重试；页面加载即 `sync`；保留 5 s 心跳（很便宜，能区分"服务挂了"和"没字幕"）。
6. **句子上限**：服务端只保留 `max(2, pairs) + 2` 句就够；100 句是给历史/诊断用的。

### 5.2 可以砍（账号/服务器语义，本地没有对应物）

| 可砍 | 位置 | 理由 |
|---|---|---|
| token / `location.hash` / `view_denied` / `link_invalid` / view link epoch | `hosted.py:1862-1894`、`1998-2008` | 本机单人，无鉴权（AGENTS.md 硬规则：只监听 127.0.0.1，不做鉴权） |
| `/view/live` 稳定地址、30 min 等待、换场自动改挂 | `hosted.py:1832-1856, 1901-1906` | 单机没有"下一场"概念，一个页面一个 hub 即可 |
| 1008 关闭语义 + control 帧 | `hosted.py:1998-2012`、`hosted-viewer.js:198-206` | 保留一个 `{type:'control',code:'waiting'}` 给"未开始"状态就够 |
| paint 回执 / seq→sent_at 映射 / TimingLog / Timeline | `hosted-paint.js`、`hosted_timing.py`、`hosted.py:1787-1820` | 纯诊断；本地用控制台打点 |
| `beat` / `visibility` / `raf_stall` 看门狗 / reload 冷却 | `hosted-viewer.js:256-388` | 本地浏览器源不会跨 CDN、不会长时间挂起；保留"12 s 无消息重连"即可 |
| `client_error` 上报、faultBox 的 30 s/8 s 分支 | `hosted-viewer.js:90-132` | 本地保留一个 3 行错误条或 `console.error` 足够 |
| 账号级 preferences（SQLite + 白名单 merge） | `hosted.py:78-169` | 换成本地 `config.toml`；但**建议保留同样的范围校验**，防止坏配置把 OBS 页面打崩 |
| `language_catalog` / `mode` / `route_generation` / `usage_owner` | `hosted.py:1933-1937` | 本地固定 `ja→zh` 时不需要 |
| `?surface=preview` 分支 | `hosted-viewer.js:25, 102` | 本地可保留一个 `?preview=1` 就够 |

设置面板可简化，但这 16 项都要留：pairs、order、`zh_size`、`ja_size`、两个文字色、描边宽/色、背景色/透明度、position、margin、line_gap、clear 秒数、bilingual。

### 5.3 建议补齐（参考实现的真实缺口）

1. **`position` 加 `center`**：当前只有 top/bottom（服务端也只认这两个，`hosted.py:108`），UI 没有 center。加的时候注意根节点已用 `transform:translateX(-50%)` 做水平居中，竖直居中要改成 `top:50%; transform:translate(-50%,-50%)`，别把原来的 translateX 覆盖丢。
2. **淡入/淡出**：hosted 完全没有；可直接搬本地版 `overlay/index.html` 的 `rise`（180 ms）+ 200 ms `fadeOut`。
3. **按字数延长停留**：长句在固定 5 s 内读不完，本地版已有成熟公式（`1500 + 130ms/字`，上限 15 s），建议照搬。
4. **总行数上限**：`pairs=6` × 多目标语言时最多 18 行，且没有 `max_lines` 保护，是否溢出取决于字号/分辨率（未实测）；hosted 的 `max_lines` 字段形同虚设，本地版应真正实现。
5. **清屏与重绘的竞态**：`applyOverlay → __livesubRows` 会让已清屏的句子复活（见 2.6），本地实现要么让渲染函数检查 `cleared` 标志，要么清屏时把 `last` 置空。

---

## 6. 没有验证到的部分（明确列出，不要当成事实）

1. **没有启动参考服务、没有在 Chrome/OBS 里打开过页面**。全文所有行为结论都来自源码阅读；没有截图、没有实测时序、没有真机 OBS 验证。
2. **没有验证 OBS 的 CEF 对 `-webkit-text-stroke` + `paint-order:stroke fill` + 透明背景的支持**，也没有验证 90% 宽度、`font-weight:700`、固定 `text-shadow` 在 1080p 下的实际观感。
3. **"空闲时每 2 s 一条快照"是从 `asyncio.wait(..., timeout=2)` + `state.snapshot()` 推导的**，没有在真实会话里量过频率、带宽和 CPU。
4. **"清屏后改样式导致旧句复活"（2.6）未实测**，只是调用路径成立。
5. **没有通读 `hosted-studio.html` 全文**（80 KB）。只读了 300-490（字幕外观表单）、600-960（设置读写、样例、populate）、1040-1120（偏好保存、音频）、1225-1290（事件绑定），其余麦克风采集、历史列表、计费/登录 UI 未覆盖。
6. **没有读 `docs/SUBTITLE-THEME-DESIGN.md` 正文**，只看开头和目录。该文档自述是"设计参考，不构成事实"，且其引用的行号（如 `hosted.py:56-86`）与当前 HEAD 已不一致，**不能当事实来源**。
7. `hosted-quality.js` 与字幕显示**无关**：它只服务 studio 页的 `#quality` 图表，找不到节点就直接 return（全文 33 行已读完）。
8. **没有验证 `LIVESUB_DRAFT_SUBTITLES` 在生产环境的默认取值**，所以"partial 译文有多常见"不确定。
9. **没有验证 `?target=` 的业务用途**：viewer 会读它，但我在 `hosted-studio.html` 里 grep 不到生成 `target=` 的代码（OBS 地址只拼 `/view/live#<token>`，`hosted.py:1335`），推测是留给人工在 URL 上限定语言用。【推】
10. **没有验证多目标语言下 `pairs=6` 的实际换行/溢出表现**，也没有验证 `font_family` 里写中文字体名时服务端正则的实际放行结果（`\w` 是 Unicode 语义，理论上可以）。

---

## 附：关键行号索引

| 主题 | 位置 |
|---|---|
| 页面模板 / 兜底 CSS | `hosted_view.py:10-22` |
| 三段脚本拼接顺序 | `hosted_view.py:29-33` |
| 样式 CSS 与 `applyOverlay` | `hosted-overlay.js:4-41` |
| 绘制回执 | `hosted-paint.js:6-49` |
| 渲染 / 去重 / 清屏 | `hosted-viewer.js:141-179` |
| 消息分发 | `hosted-viewer.js:208-240` |
| 连接 / 鉴权 / 重连 | `hosted-viewer.js:242-343` |
| 看门狗 | `hosted-viewer.js:373-388` |
| 对数 / 顺序 / 行构造 | `hosted-viewer.js:394-430` |
| 偏好默认值 | `hosted.py:78-84` |
| 偏好校验 | `hosted.py:87-119` |
| 偏好读写 API | `hosted.py:1446-1462` |
| snapshot 发送循环 | `hosted.py:1900-1971` |
| snapshot 载荷 | `hosted.py:1933-1937` |
| 关闭与控制码 | `hosted.py:1998-2012` |
| 快照数据结构 | `subtitle_state.py:7-10` |
| 订阅即发 | `subtitle_gateway.py:48-56` |
| 事件字段定义 | `subtitle_protocol.py:7-25` |
| 本地版外观默认值 | `config.py:144-163` |
| studio 表单 | `hosted-studio.html:326-490` |
| studio 读/存偏好 | `hosted-studio.html:621, 746-756, 1073-1097, 1245-1246` |
| 延迟诊断 | `hosted_timing.py:96-124` |
