# Contributing / 参与贡献

Thanks for helping improve EZWRITING. Small, focused bug reports and pull requests are the most useful contributions at this stage.

感谢你帮助改进 EZWRITING。当前阶段最有价值的是范围明确、可以复现的问题和小型 Pull Request。

## Before opening an issue / 提交 Issue 前

1. Read the [known issues](./docs/KNOWN_ISSUES.md) and [platform support matrix](./docs/PLATFORM_SUPPORT.md).
2. Confirm the problem still occurs in the current live demo or latest `main` branch.
3. For publishing problems, record the browser version, Wechatsync version, target platform, and whether the platform session is still valid.
4. Remove account names, cookies, tokens, unpublished article content, and private draft links from screenshots and logs.

1. 先查看[已知问题](./docs/KNOWN_ISSUES.md)和[平台支持矩阵](./docs/PLATFORM_SUPPORT.md)。
2. 确认问题在当前在线版本或最新 `main` 分支中仍然存在。
3. 发布问题请记录浏览器版本、Wechatsync 版本、目标平台和平台登录状态。
4. 截图与日志中请删除账号名、Cookie、Token、未公开正文和私密草稿链接。

Use the repository's Bug Report or Feature Request form so the report contains enough context to act on.

请使用仓库内的 Bug Report 或 Feature Request 表单提交问题。

## Development setup / 开发环境

Requirements: Node.js 24.15 or later.

环境要求：Node.js 24.15 或更高版本。

```bash
git clone https://github.com/KeepATARAXIA/ezWriting.git
cd ezWriting
npm install
npm run dev
```

Run the full verification before submitting a pull request:

提交 Pull Request 前请运行完整验证：

```bash
npm run verify
npm audit --audit-level=high
```

## Change scope / 修改边界

- Keep changes focused on one problem. Avoid unrelated refactors or formatting churn.
- Preserve the separation between article normalization, editing and previews, local persistence, and the publishing bridge.
- Do not add target-platform private API structures directly to UI components.
- Parser, persistence, pagination, and publishing-bridge behavior should include regression tests.
- New dependencies require a clear reason and should not duplicate existing capabilities.
- 一次修改只解决一个问题，避免无关重构和大面积格式化。
- 保持文章规范化、编辑预览、本地存储和发布桥接之间的分层。
- 不要把目标平台的私有 API 结构直接写进 UI 组件。
- 解析、存储、分页和发布桥接行为应包含回归测试。
- 新依赖需要说明必要性，且不应重复现有能力。

## Pull requests / Pull Request 要求

- Explain what changed, why it changed, and how it was verified.
- Link the related issue when one exists.
- Include before/after screenshots for visible UI changes.
- Describe remaining platform or browser uncertainty instead of presenting unverified behavior as supported.
- 说明改了什么、为什么修改、如何验证。
- 有关联 Issue 时请附上链接。
- 可见界面变化请提供修改前后截图。
- 对尚未验证的平台或浏览器行为准确标注不确定性。

## License / 许可证

By contributing, you agree that your contribution may be distributed under the repository's [MIT License](./LICENSE).

提交贡献即表示你同意相关内容按照仓库的 [MIT License](./LICENSE) 分发。
