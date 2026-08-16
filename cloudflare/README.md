# Cloudflare Static Hosting / Cloudflare 静态托管

Cloudflare Worker 只负责发布 Vite 静态资源和健康检查。稿件、图片、排版设置与历史记录全部保存在用户当前浏览器的 IndexedDB，不再提供账号、注册、云同步或 D1 数据库。

## Local Development / 本地开发

- `npm run dev`：启动 Vite 开发服务器。
- `npm run worker:dev`：使用 Worker 静态资源边界进行本地验证。
- `npm test`：运行前端、本地仓储与 Worker 回归测试。
- `npm run build`：运行类型检查并生成生产资源。

## Remote Deployment / 远端部署

执行 `npm run worker:deploy` 会先构建前端，再将 `dist` 作为 Worker Static Assets 发布。`/health` 返回 `{ "status": "ok", "storage": "local-only" }`；旧 `/auth/*` 与 `/sync/*` 路径固定返回 `410 Gone`，防止旧客户端误以为云端数据仍可用。

## Local Data Boundary / 本地数据边界

- 正常关闭网页或浏览器后，同一设备、同一浏览器、同一域名再次打开仍会恢复稿件。
- 无痕窗口、清理网站数据、更换浏览器或更换域名不会继承原 IndexedDB。
- 历史侧栏提供完整数据导出与导入，备份包含稿件、图片和稿件级排版设置。
- 应用会请求浏览器启用持久化存储，但用户仍应在换域名或清理浏览器前主动导出备份。
