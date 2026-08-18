# Changelog / 更新日志

All notable changes to EZWRITING are documented in this file. The project follows [Semantic Versioning](https://semver.org/).

所有值得关注的 EZWRITING 变更都会记录在这里。项目版本遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased] / 未发布

### Planned / 计划

- Continue real-account verification for the Wechatsync publishing bridge.
- Improve compatibility reporting when target platforms or the browser extension change.
- 继续使用真实账号验证 Wechatsync 发布桥接。
- 在目标平台或浏览器扩展发生变化时，提供更明确的兼容状态。

## [0.1.0] - 2026-08-18

### Added / 新增

- Local-first Markdown, HTML, ZIP, and article-folder import with HTML sanitization and ZIP safety limits.
- One canonical Markdown draft with WeChat Official Account, Xiaohongshu card, and X Article previews.
- IndexedDB autosave, image deduplication, draft history, soft deletion, and full-library backup import/export.
- Twenty-six WeChat article themes and copyable inline-styled output.
- Xiaohongshu 3:4 card pagination, image layouts, full-resolution PNG export, and multi-card ZIP export.
- Replaceable Wechatsync bridge with account discovery, multi-platform selection, per-platform progress, failures, and draft links.
- Cloudflare static hosting configuration, CI verification, and 148 automated tests across 24 test files.
- 本地优先的 Markdown、HTML、ZIP 与文章文件夹导入，并提供 HTML 安全过滤和 ZIP 解压限制。
- 一份 Markdown 主稿对应微信公众号、小红书卡片和 X Article 三种预览。
- IndexedDB 自动保存、图片去重、稿件历史、软删除与整库备份导入导出。
- 26 套公众号主题及可复制的内联样式正文。
- 小红书 3:4 卡片分页、图文排版、全分辨率 PNG 与多卡片 ZIP 导出。
- 可替换的 Wechatsync 桥接，支持账号发现、多平台选择、逐平台进度、失败反馈和草稿入口。
- Cloudflare 静态托管配置、CI 验证，以及分布在 24 个测试文件中的 148 项自动测试。

### Known limitations / 已知限制

- Publishing depends on Wechatsync, active browser sessions, and target-platform behavior.
- Dedicated previews currently focus on WeChat Official Account, Xiaohongshu, and X Article.
- 发布能力依赖 Wechatsync、浏览器登录状态和目标平台当前行为。
- 专属预览目前集中在微信公众号、小红书和 X Article。
