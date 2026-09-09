# Codex Local Connection / Codex 本地连接

让 EZWRITING 的试写和选段润色使用本机 Codex 登录账号的 ChatGPT 订阅额度。无需 OpenAI API Key，不通过 Cloudflare Worker 转发。

## Start / 启动

前提：已安装项目依赖、Node.js 24.15+、Codex CLI，并通过 `codex login` 选择 ChatGPT 登录。Windows 上已验证 Codex CLI 0.146.0；其他系统与旧版 CLI 尚未实测。

在项目目录运行：

```sh
npm run codex:bridge
```

保持终端运行。在网页的「AI 工具 → Codex」粘贴终端显示的连接码，点击「连接本机 Codex」。连接后可选择账号可用模型、查看额度、测试连接、试写和润色选段。模型列表由本机 Codex 提供，不硬编码模型名称。

开发网页仍通过 `npm run dev` 启动，连接程序独立运行。连接程序只监听 `127.0.0.1:48765`。Ctrl+C 关闭；每次重新启动会产生新连接码，需要重新配对。网页的「断开连接」只清除当前标签页连接码，不退出本机 Codex 账号、不终止其他 Codex 会话。

如果无法自动找到本机 Codex，可在启动前设置 `EZWRITING_CODEX_BIN` 为现有 Codex 原生可执行文件的绝对路径。Windows 使用 `codex.exe`，不填 `codex.cmd` 或 PowerShell 包装脚本。不自动安装或升级 CLI。

## Boundaries / 边界

- 仅接受固定来源：本地开发/预览端口 4173、4174，以及 `https://ezwriting.online` 和 `https://www.ezwriting.online`。来源和 Host 都需匹配，实际请求必须携带本次随机连接码；不提供通用代理或任意 Codex RPC 接口。
- 连接码仅保存在当前标签页的 sessionStorage（不可用时用内存），与 AI 提供商 Key、稿件、备份和诊断隔离。浏览器的会话恢复功能可能恢复标签页会话；服务重启使旧连接码失效。
- Codex 自行管理 ChatGPT 登录凭据。本程序不读取或复制 `auth.json`，不在网页中保存 OpenAI 登录凭据；每次生成先检查账号必须为 `chatgpt` 类型，拒绝 API Key 等登录方式。
- 只发送本次试写输入，或用户确认的选段、有限上下文及勾选方案的提示词和强度。预设保存在当前浏览器本地，不随稿件备份；测试连接只发送固定的短提示，额度刷新不发模型生成请求。
- 每次生成启动独立的 app-server 进程和临时会话，使用空临时工作目录，不继承项目 AGENTS.md。禁用 shell、浏览器、计算机、图像生成、插件、hooks、记忆和多 Agent 功能；覆盖已配置 MCP 为禁用，并关闭环境访问。不会改动用户全局 Codex 配置。
- 只输出最终助手文字，过滤进度和推理内容。为防止中途进度污染方案 JSON，当前版本等最终回复完成后再交给界面展示；等待期间显示耗时，方案接收进度保持 0%，不模拟模型内部进度。按用户勾选数量约束 1–6 个候选，继续复用已有长度、格式、链接校验和选区应用/撤销保护。强度 0–100 是改写指导，不能保证精确修改字数占比。
- 更新选段润色代码后，已运行的连接程序需 Ctrl+C，再执行 `npm run codex:bridge` 并用新连接码配对，才能使用新的自定义方案协议。
- 同时只处理一条请求；重复调用返回忙碌提示。输入上限 8,000 UTF-16 单元，HTTP 请求体上限 48 KiB，回复文字上限 64,000 单元。120 秒超时、停止、关闭面板或浏览器断开都会结束本次 app-server 进程；已产生的用量不会退回。
- 本程序不记录或持久化正文、协议消息、原始错误或登录信息；OpenAI 服务自身的数据处理规则仍适用。

## Verification / 验证

```sh
npm test
npm run build
npx playwright test e2e/codex-connection.spec.ts e2e/ai-connections.spec.ts e2e/ai-polish.spec.ts
```

普通测试使用模拟数据，不消耗订阅额度。真实浏览器冒烟用例默认跳过；仅在已获用户许可时，将当前连接码通过环境变量 `EZWRITING_CODEX_SMOKE_TOKEN` 传入 Playwright，并运行 `e2e/codex-connection.spec.ts`。测试使用合成短文，验证试写、三个候选、应用与撤销。

Windows + Chrome + 本地前端已完成真实订阅验证。线上域名到本机的连接可能需要浏览器「本地网络访问」许可；本次未部署或实测线上页面，也未验证手机访问电脑上的连接程序。

协议依据：[Codex App Server](https://learn.chatgpt.com/docs/app-server)、[Authentication](https://learn.chatgpt.com/docs/auth)。本次实现同时核对了本机 CLI 生成的实验性协议类型。
