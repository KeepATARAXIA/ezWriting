# Cloudflare Hosting / Cloudflare 托管

Cloudflare Worker 负责 Vite 静态资源、健康检查和用户主动触发的 AI 请求转发。稿件、图片、排版设置与历史记录仍保存在用户当前浏览器的 IndexedDB，不提供账号、注册、云同步或 D1 数据库。

## Local Development / 本地开发

- `npm run dev`：一键启动本地 Worker（8787）与 Vite（4173），等待 Worker 健康检查通过后启动前端；首次缺少 `dist` 时自动构建静态资源。按 Ctrl+C 同时关闭两项服务，任一服务退出也会关闭配套服务。端口占用时明确报错，不自动切换站点端口。
- 首次运行 `npm run build`，然后运行 `npm run worker:dev`：在 `http://127.0.0.1:8787` 验证完整前端与 AI 接口。
- `npm run dev:frontend`：仅启动前端，适合已有独立 Worker 的情况。`/api/ai/*` 转发到本地 `8787` Worker；仅本地代理重写 Origin，生产接口要求请求同源。
- `npm test`：运行前端、本地仓储与 Worker 回归测试。
- `npm run build`：运行类型检查并生成生产资源。

## Remote Deployment / 远端部署

执行 `npm run worker:deploy` 会先构建前端，再将 `dist` 作为 Worker Static Assets 发布。`/health` 返回 `{ "status": "ok", "storage": "local-only" }`；旧 `/auth/*` 与 `/sync/*` 路径固定返回 `410 Gone`，防止旧客户端误以为云端数据仍可用。

## Local Data Boundary / 本地数据边界

- 正常关闭网页或浏览器后，同一设备、同一浏览器、同一域名再次打开仍会恢复稿件。
- 无痕窗口、清理网站数据、更换浏览器或更换域名不会继承原 IndexedDB。
- 历史侧栏提供完整数据导出与导入，备份包含稿件、图片和稿件级排版设置。
- 应用会请求浏览器启用持久化存储，但用户仍应在换域名或清理浏览器前主动导出备份。

## AI Connection / AI 接入

- 导航中的「AI 工具」支持 Gemini（默认 `gemini-3.8-flash`）、DeepSeek（默认 `deepseek-v4-flash`）与智谱 GLM（默认 `glm-5.3`）。模型名称可改为账号已开通、支持流式对话的模型 ID。
- 各提供商的 API Key、模型名称与最后选用的提供商保存在当前浏览器 localStorage，刷新或重新打开同一站点后恢复；「清除所有 Key」清空所有本地密钥。存储失败时明确提示，当前页面仍可使用。Key 不进入稿件、备份、诊断报告、仓库或服务端日志；清理网站数据或更换浏览器/域名需重新输入。
- `POST /api/ai/generate` 接收 `X-AI-Key` 请求头与 JSON `{ provider, model, action, prompt? }`。`action` 为 `test` 时使用服务端固定短提示，不发送试写区或稿件；`generate` 只发送用户明确输入的试写内容；`polish` 使用独立系统指令，将选段及上下文作为 JSON 数据发送，一次返回三方案。
- Worker 仅允许三家官方地址，禁止跟随重定向，不接受自定义转发地址。无需部署共享 Key 或新增服务端密钥绑定。
- 返回经过归一化的 SSE：`{ type: "delta", text }`、`{ type: "done" }` 或 `{ type: "error", code }`。不返回厂商原始错误消息、请求头、推理内容。只有收到正常结束标记和非空正文才报告成功。
- 当前输入限 8,000 个 UTF-16 单元、请求体限 48 KiB；普通输出预算 4,096 tokens，润色按选段长度动态分配 768–8,192 tokens。上游请求与流读取共限 120 秒，客户端兜底 125 秒。连接测试也可能计费，不自动重试。停止和关闭面板会取消请求，已产生的用量由厂商结算。
- 服务端仅转发本次请求，不持久化正文或 Key；厂商自身的数据处理与保留规则由相应服务决定。未来新增日志、监控或错误上报时不得记录请求内容与密钥。
- 左侧 AI 栏保留模型设置与试写。选中正文后点击浮动工具栏 AI 图标，打开独立润色弹窗，原文默认展开；用户在弹窗点击生成、并排比较三方案、选择应用，完成后返回编辑器。手机三方案竖向排列。
- 每次选段最多 2,000 个 UTF-16 单元；上下文仅取前后各两条非空源码行/段落，每侧最多 600 单元，前后同段的片段也计入。Worker 再次校验范围，只将规定字段作为素材发送；每个输出最多为原文的 1.5 倍（短句下限 40 字符），客户端拒绝过长扩写。
- DeepSeek 润色显式使用 `thinking: { type: "disabled" }` 与 `response_format: { type: "json_object" }`，避免默认深度思考占用短句输出预算。其他提供商不附加 DeepSeek 特定参数。依据：[DeepSeek Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)、[Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)。
- 完整三方案通过校验后才允许应用，HTML 标签和链接变化会被拦截。只替换捕获的选区，保持一次撤销；期间稿件有任何文本变更或切换编辑器，旧结果不能覆盖当前稿件。快照、回调和选区偏移仅保留在本地内存，不发送给模型。
- Codex 使用独立本地连接，支持订阅试写与选段三方案；启动、配对与边界见 [Codex 本地连接](../local-codex/README.md)。Worker 明确拒绝 `provider: "codex"`。全文润色尚未实现。

## AI Verification / AI 验证

- `npm test`：包含提供商地址、密钥隔离、请求边界、错误脱敏、UTF-8/SSE 分块、空回复、输出截断、超时与取消回归。
- `ai-runtime.test.ts` 使用现有 Wrangler 附带的 esbuild 与 Miniflare/workerd 验证真实运行时参数、完整 SSE 输出和重定向拒绝，不访问厂商或消耗额度。当前 workerd 不接受 `redirect: "error"`，使用 `manual` 后按非 2xx 响应拒绝重定向。
- `npm run build` 后运行 `npx playwright test e2e/ai-connections.spec.ts e2e/ai-polish.spec.ts e2e/workbench-feedback.spec.ts`：使用模拟回复验证浏览器交互、三方案与差异对比、选区替换和撤销、过期结果保护、密钥本地恢复与清除、取消与窄屏布局，不消耗模型额度。
- 真实联调需要在界面中填写对应厂商有效 Key，点击「测试连接」及「生成文字」；模拟测试不能证明账号额度、地区可用性或指定模型的实际权限。
- 官方接口依据：[Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)、[DeepSeek API](https://api-docs.deepseek.com/)、[GLM 对话补全](https://docs.bigmodel.cn/api-reference/模型-api/对话补全)。
