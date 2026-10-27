**中文** | [English](README.md)

# 余额与余量 · dsh-balance-meter

> 一个装在 DeepSeek Harness 里的小插件：**随时告诉你现在用的这个模型，还剩多少额度。**

你不需要打开各家的控制台、不用自己算、也不会被一个过期的数字骗到 —— 如果真的查不到，它会直说是为什么。

![输入框下方的余额读数](docs/images/chip.png)

点一下这个读数，展开完整面板：

![余额与余量详情面板](docs/images/panel.png)

---

## 它解决什么问题

用 API 或者订阅额度跑 agent，最怕两件事：

1. **跑到一半额度没了**，任务中断，才发现余额是 0。
2. **打开一堆控制台**去核对 —— DeepSeek 一个站、Kimi 一个站、智谱又一个站，而且各家说法还不一样：有的给钱数，有的给百分比。

这个插件把这件事收成一处：**当前会话在用哪个模型，它就查哪个模型对应的额度**，并且用同一种方式展示。

---

## 它能查什么

它是**按供应商**查的，不是按模型查的 —— 同一个供应商下的所有模型共用一份额度。

### ✅ 能查：内置 9 家

| 供应商 | 查什么 | 显示成 |
|---|---|---|
| **DeepSeek** | 账户余额 | 金额（如 `¥12.34`） |
| **OpenRouter** | 密钥额度 | 金额 |
| **Moonshot / Kimi** | 账户余额 | 金额 |
| **SiliconFlow** | 账户余额 | 金额 |
| **智谱 GLM / Z.AI** | 订阅额度 | 窗口百分比 |
| **Kimi Coding** | 订阅额度 | 窗口百分比 |
| **MiniMax** | 套餐余量 | 窗口百分比 |
| **OpenCode Go** | 订阅额度 | 窗口百分比 |
| **OpenDesign (AMR)** | 钱包 + Design Plan 窗口 | 金额 + 百分比 |

「窗口百分比」是指它会把**滚动 / 每周 / 每月**这类额度周期逐个列出来，各带进度条和重置时间。所以你能看出「是这个 5 小时的窗口快满了，还是这个月的总量见底了」。

### ⚠️ 可能能查：常见中转站

如果你用的是**自建中转站**（New-API、Sub2API、CloseAI、claude-code-hub 这类面板），插件会按一组常见接口自动试一遍：

```
/api/usage/token/  →  /v1/dashboard/billing/subscription  →  /v1/usage
→  /api/v1/me/quota  →  /dashboard/billing/credit_grants
→  /api/v1/credits  →  /api/user/self
```

哪个先返回可读数字就用哪个。**你在插件里填的自定义接口排在最前面**，优先于全部预设。

> 这套机制（顺序、短路、单位校准）有测试覆盖，但**各条预设的响应结构是从公开面板清单整理的，作者无法逐家实机验证**。所以认不出时会明确报「可连通·无法解析」并附上原始响应，而不是猜一个数字给你。

### ❌ 不能查：这些情况

| 情况 | 会怎样 |
|---|---|
| **供应商没有公开余额接口** | 明确说「官方没有公开接口」，不编造 |
| **路由不在内置目录里，且中转站预设都没命中** | 报「未收录」，并附最后一次的原始响应 |
| **凭据没配** | 指出去配哪个环境变量 |
| **接口通了但结构不认识** | 报「无法解析」，附响应片段（已遮蔽密钥） |

「未收录」的意思是 **本插件还不认识这个供应商**，不等于它没有余额接口。这时用 `balance_set_endpoint` 填一条自定义接口就能解决。

---

## 安装

```sh
dsh plugin --profile desktop add @zhujiuyi/dsh-balance
```

装完**重启 DSH**，输入框下方的状态行就会出现读数。

> **别装 `dsh-balance-meter`**（不带作用域）。那个名字在 npm 上属于别人。

不想用 npm 的话，也可以直接装 Release 里的 tarball（路径里的 `/latest/` 会自动指向最新一版，不用手改版本号）：

```sh
dsh plugin --profile desktop add https://github.com/zhujiuyi/dsh-balance-meter/releases/latest/download/zhujiuyi-dsh-balance-0.2.5.tgz
```

从仓库直接装也可以：

```sh
dsh plugin --profile desktop add github:zhujiuyi/dsh-balance-meter
```

卸载：

```sh
dsh plugin --profile desktop remove @zhujiuyi/dsh-balance
```

---

## 怎么用

装好之后你基本什么都不用做。三种使用方式：

**1. 看一眼** —— 状态行的读数常驻，余额是钱数，订阅是百分比。

**2. 点开看详情** —— 供应商、计费方式、接口地址、最近读取时间；订阅渠道会逐个列出额度窗口。

**3. 问 agent** —— 直接说「还剩多少额度」，它会调 `balance_check` 工具去查。

---

## 关于「数字准不准」这件事

这是本插件最在意的一点。三条规则：

**① 绝不猜数字。** 查不到就报查不到，并说明原因。宁可显示「无法查询」，也不会给你一个看起来合理但是错的数。

**② 过期数字会标注。** 一次自动刷新失败、但之前成功读过时，读数继续显示上次的值，并标注「可能已过期」，失败原因写在详情里。不会把旧数字当成当前值。

**③ 趋势图只用真实读数。** 面板里那条曲线来自**实际发生过的读取**，不是画出来好看的示意线。读数不足两次时，它会说「正在累积读数」，而不是假装有一条历史曲线。

### 什么时候会自动刷新

- **每轮对话结束后** —— 刷新一次
- **后台每 15 秒检查一次** —— 满足条件就刷新
- **读数超过 5 分钟没更新** —— 强制刷新一次（可在设置里改）
- **你点「立即刷新」** —— 无条件刷新

刷新受两个值约束：**最小间隔**（默认 30 秒，避免把供应商打爆）和**失败冷却**（出错后不立刻重试）。页面不可见时不会轮询。

---

## OpenDesign 用户请注意

OpenDesign 是唯一一个**账单不在 API 网关主机上**的供应商，需要额外一步：

```sh
vela login          # 或在 OpenDesign 桌面端登录
```

登录后凭据会写到 `~/.amr/config.json`，插件自动读取。

**为什么必须这样**：DSH 里配的 `sk-amr-…` API Key 是**推理用**的 runtime key，官方明确规定它不能读账单。余额只能用它登录产生的另一个凭据（controlKey）来查。

没登录时插件会直接告诉你该跑 `vela login`，而不是把这个网关当成未收录的中转站乱试。

---

## 设置

插件页 → `@zhujiuyi/dsh-balance` 卡片：优先显示的路由、是否自动刷新、最小刷新间隔、超过多久自动刷新。

要给某个路由指定自定义接口或凭据变量名，编辑 profile 的 `cordis.patch.yml` 里 `balance-meter` 那一行：

```yaml
- id: balance-meter
  name: "@zhujiuyi/dsh-balance"
  config:
    primary: deepseek
    routes:
      - id: my-provider
        baseURL: https://api.example.com/v1
        apiKeyEnv: MY_PROVIDER_API_KEY
        endpoint: '{origin}/v1/balance'
```

模板支持 `{origin}`（scheme + host）和 `{base}`（完整 baseURL）。用 `{origin}` 更稳，不受 baseURL 带没带路径段影响。

---

## 隐私

- **不申请 exec 权限，不启动子进程** —— 没有 shell、没有 curl。
- **只请求你自己配置的那个网关** —— 没有第三方域名、没有遥测、没有回传。
- **密钥只用于该网关** —— 从 DSH 凭据库读取，放进请求头，不落盘、不入日志、不进浏览器快照。快照里只有变量名，没有值（有测试断言）。
- **不写 DSH 的其他配置** —— 只改本插件自己那一行。

---

## 给开发者

```sh
npm run verify   # 静态契约检查 + 全部测试
npm test         # 305 个测试，不需要安装 DSH
npm run check    # 只跑静态契约检查
```

测试分四层，全部不依赖 DSH：纯逻辑（解析器、探测链、缓存节流）、宿主半集成（桩替代 `@deepseek-ai/*`，跑真实 `apply()`）、静态契约检查、以及**浏览器半的渲染测试**（真实加载 `client.js` 用最小 React 桩渲染各状态）。

最后那层是必要的：一个 `useMemo` 在 `const` 声明前引用了变量，属于运行时作用域错误 —— `node --check` 和契约检查都发现不了，但会让整个组件崩溃、入口消失。这个 bug 确实发生过一次。

### 已知的实测状态

9 家中，**只有 OpenCode Go / OpenDesign 拿到过真实响应**并据此修正过解析。其余各家若结构与文档不符，会走「可连通·无法解析」并回显原始响应 —— 把回显发我即可修正。

### 与参考实现的差异

本插件是 [ccgui-plugin-balance-meter](https://github.com/zhujiuyi/ccgui-plugin-balance-meter)（CC GUI 版）的 DSH 移植。因为 DSH 原生提供凭据与 HTTP 出口，这一版**不需要 exec 权限**：

| | CC GUI 版 | 本插件 |
|---|---|---|
| 读凭据 | 自己解析各引擎配置，须 `exec:curl` | `ctx.credentials` 直接读 |
| 联网 | 宿主要求预声明域名，只能用 `exec:curl` | 进程内直接 `fetch` |
| 识别路由 | 嗅探网关域名 | `ctx.llm.listProviders()` + profile |

其他差异：界面在输入框下方状态行（`conversation.composer.dock`）而非状态栏；状态行把**每个能读出数字的窗口并列显示**（5 小时 · 每周 · 每月）——套餐是在任意一个窗口耗尽时停你，而不是只看跨度最短的那个。chip 上「5 小时」标签为绿色、「周」标签为蓝色、剩余 0% 的标签变红，数字保持白色。

设计规格见 [docs/superpowers/specs/2026-10-14-dsh-balance-meter-design.md](docs/superpowers/specs/2026-10-14-dsh-balance-meter-design.md)。

---

## 许可

MIT
