# Changelog / 更新日志

All notable changes to EZWRITING are documented in this file. The project follows [Semantic Versioning](https://semver.org/).

所有值得关注的 EZWRITING 变更都会记录在这里。项目版本遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased] / 未发布

### Planned / 计划

- Continue real-account verification for the Wechatsync publishing bridge.
- Improve compatibility reporting when target platforms or the browser extension change.
- 继续使用真实账号验证 Wechatsync 发布桥接。
- 在目标平台或浏览器扩展发生变化时，提供更明确的兼容状态。

## [0.2.0] - 2026-08-20

### Added / 新增

- A deterministic reliability corpus covering Markdown, Obsidian/GFM structures, unsafe HTML, missing assets, Xiaohongshu pagination, and reproducible ZIP packages.
- Privacy-safe diagnostic export with recent import stage timings, app/browser state, local draft count, and explicit content/filename/account exclusions.
- A real-Chromium reliability gate covering import/autosave recovery, cross-origin backup restore, diagnostic privacy, Xiaohongshu export dimensions, blank publishing, duplicate actions, delete/undo, and stale-tab conflicts.
- 可复现的可靠性样本库，覆盖 Markdown、Obsidian/GFM 结构、不安全 HTML、缺图、小红书分页和 ZIP 内容包。
- 脱敏诊断报告，包含近期导入阶段计时、应用/浏览器状态和本地稿件数，并明确排除正文、文件名和账号信息。
- 真实 Chromium 可靠性门禁，覆盖导入与自动保存恢复、跨域备份、诊断隐私、小红书导出尺寸、空稿发布、重复操作、删除撤销和多标签冲突。

### Changed / 变更

- Reworked local image replacement into concurrent reads, cached data-URI conversion, and single-pass Markdown reconstruction; the 34-image, roughly 10.6 MB regression fixture completes below the 10-second gate.
- Removed an unused Tiptap editor implementation and its direct dependencies; clarified local copy/PNG/ZIP export as the core workflow and Wechatsync delivery as experimental.
- Pinned the directly downloadable Wechatsync package wording to the verified 2.0.9 build instead of presenting it as the latest release.
- Made publishing an exclusive, per-account state machine: duplicate clicks are ignored, incomplete callbacks stay pending, late or uncorrelated updates fail safely, and retries exclude already successful platforms.
- Made backup import atomic, protected drafts with optimistic revision checks across tabs, flushed edits before deletion, and preserved unsaved memory content in emergency backups when IndexedDB writes fail.
- Applied the same image count and byte limits to repair folders while ignoring unrelated folder files.
- 将本地图片替换改为并发读取、Data URI 缓存和 Markdown 单次重建；34 张图片、约 10.6 MB 的回归样本通过 10 秒门禁。
- 移除未使用的 Tiptap 编辑器实现及其直接依赖；明确本地复制/PNG/ZIP 导出是核心流程，Wechatsync 同步为实验能力。
- 将可直接下载的 Wechatsync 安装包明确标注为已验证的 2.0.9，而不再声称是最新版。
- 将发布流程改为互斥的逐账号状态机：忽略重复点击、等待完整回调、安全拒绝迟到或无法归属的状态，并在重试时排除已成功平台。
- 备份导入改为原子事务；多标签保存增加版本冲突保护；删除前强制保存最新编辑；IndexedDB 写入失败时，应急备份仍包含内存中的当前稿。
- 补图文件夹复用图片数量与体积限制，同时忽略文章文件和系统杂项文件。

### Security / 安全

- Added response headers that block framing and object embedding, reduce referrer leakage, disable unused device permissions, and prevent MIME sniffing without restricting the extension bridge script path.
- Enforced streamed ZIP limits against actual decompressed bytes, rejected duplicate normalized archive paths, and stopped buffering oversized entries.
- Hardened imported HTML against page-overlay styles, automatic media requests, unsafe data attributes, and forged missing-image actions while preserving article typography.
- 为静态站点和健康检查增加防嵌入、减少来源泄漏、禁用未用设备权限和禁止 MIME 嗅探的响应头，同时不限制扩展桥接脚本路径。
- 按实际流式解压字节执行 ZIP 限额，拒绝重复规范路径，并在超限时停止缓存条目。
- 加固外部 HTML，移除页面覆盖样式、自动媒体请求、不安全 data 属性和伪造缺图操作，同时保留正文排版。

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
