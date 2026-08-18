# Roadmap / 路线图

EZWRITING is a local-first workspace for preparing one article for multiple publishing destinations. The roadmap prioritizes reliable authoring, platform-specific presentation, and human-reviewed draft delivery over unattended publishing or a large platform-adapter catalog.

EZWRITING 是一个本地优先的多平台内容分发工作台。路线图优先保证编辑可靠性、平台化呈现和人工复核后的草稿同步，不追求无人值守发布，也不重复建设大规模平台适配器。

## Now — v0.1 / 当前阶段

- Keep Markdown as the canonical editable source while preserving HTML, images, tables, code, callouts, and front matter during import.
- Maintain reliable local autosave, history, image storage, and complete backup restore.
- Provide dedicated, inspectable previews for WeChat Official Account, Xiaohongshu image cards, and X Article.
- Treat Wechatsync as a replaceable publishing executor and keep platform-specific failures visible.
- 以 Markdown 作为唯一可编辑正文，并在导入时尽量保留 HTML、图片、表格、代码、Callout 和 front matter。
- 保持本地自动保存、历史记录、图片存储和整库恢复的可靠性。
- 为微信公众号、小红书图文卡片和 X Article 提供可检查的专属预览。
- 将 Wechatsync 作为可替换发布执行器，并明确显示逐平台失败原因。

## Next — reliability / 下一阶段：可靠性

- Publish and maintain a dated [platform support matrix](./docs/PLATFORM_SUPPORT.md).
- Add repeatable real-account smoke checks for the three dedicated preview targets.
- Improve recovery guidance for expired sessions, upstream adapter changes, missing images, and partial platform failures.
- Validate backup migration across browsers and origins with real multi-image libraries.
- 发布并持续维护带验证日期的[平台支持矩阵](./docs/PLATFORM_SUPPORT.md)。
- 为三个专属预览平台建立可重复的真实账号冒烟检查。
- 完善登录过期、上游适配变化、缺图和部分平台失败的恢复指引。
- 使用真实多图稿件库验证跨浏览器、跨域名备份迁移。

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
