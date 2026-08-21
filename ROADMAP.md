# Roadmap / 路线图

EZWRITING is a local-first workspace for preparing one article for multiple publishing destinations. The roadmap prioritizes reliable authoring, platform-specific presentation, and human-reviewed draft delivery over unattended publishing or a large platform-adapter catalog.

EZWRITING 是一个本地优先的多平台内容分发工作台。路线图优先保证编辑可靠性、平台化呈现和人工复核后的草稿同步，不追求无人值守发布，也不重复建设大规模平台适配器。

## Now — v0.2 reliability / 当前阶段：v0.2 可靠性

- Keep Markdown as the canonical editable source while preserving HTML, images, tables, code, callouts, and front matter during import.
- Protect the import path with a deterministic Markdown/HTML/ZIP corpus and a 34-image performance baseline.
- Verify autosave recovery, cross-origin backup restore, privacy-safe diagnostics, and Xiaohongshu PNG dimensions in a real Chromium browser.
- Maintain the dated [platform support matrix](./docs/PLATFORM_SUPPORT.md) and treat Wechatsync 2.0.9 delivery as an experimental, replaceable executor.
- 以 Markdown 作为唯一可编辑正文，并在导入时尽量保留 HTML、图片、表格、代码、Callout 和 front matter。
- 使用可复现的 Markdown/HTML/ZIP 样本库和 34 张图片性能基线保护导入链路。
- 在真实 Chromium 中验证自动保存恢复、跨域备份导入、脱敏诊断报告和小红书 PNG 尺寸。
- 持续维护带验证日期的[平台支持矩阵](./docs/PLATFORM_SUPPORT.md)，并将 Wechatsync 2.0.9 草稿同步保持为实验性、可替换执行器。

## Next — feedback-backed hardening / 下一阶段：基于反馈的加固

- Add repeatable real-account smoke checks for the three dedicated preview targets without storing credentials or private drafts.
- Improve recovery guidance for expired sessions, upstream adapter changes, missing images, and partial platform failures.
- Validate complete backups with larger real-world libraries across additional Chromium profiles and operating systems.
- Reduce initial bundle cost only when measurements show it materially affects the editing path.
- 为三个专属预览平台建立可重复的真实账号冒烟检查，但不保存凭据或私密稿件。
- 完善登录过期、上游适配变化、缺图和部分平台失败的恢复指引。
- 使用更大的真实稿件库，在更多 Chromium 配置与操作系统中验证整库备份。
- 只有测量证明首屏包体明显影响编辑链路时，才进行代码分包优化。

## Later — focused expansion / 后续：克制扩展

- Evaluate a generic copy/export result for platforms without a dedicated preview.
- Evaluate syntax-highlighted publishing output and image-gallery workflows after the core path is stable.
- Consider additional dedicated previews only when repeated real-world demand justifies the maintenance cost.
- 评估没有专属预览的平台所需的通用复制和导出结果。
- 核心链路稳定后，再评估语法高亮发布输出和图片画廊流程。
- 只有当真实需求重复出现并足以覆盖维护成本时，才增加新的专属平台预览。

## Intentionally out of scope / 明确不做

- Unattended public posting or bulk scheduled publishing.
- An EZWRITING account system, cloud draft storage, or analytics dashboard.
- Reimplementing Wechatsync's private platform adapters inside the UI.
- DOCX/PDF import or AI rewriting in the first product stage.
- 无人值守公开发布或批量定时发布。
- EZWRITING 账号系统、云端稿件存储或数据看板。
- 在 UI 内部重新实现 Wechatsync 的私有平台适配器。
- 第一阶段不加入 DOCX/PDF 导入或 AI 改写。

Platform behavior can change without notice. Roadmap items describe direction rather than guaranteed delivery dates.

平台规则可能随时变化；本路线图表达方向，不构成固定交付日期承诺。
