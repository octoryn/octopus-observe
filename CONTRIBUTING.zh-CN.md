[English](CONTRIBUTING.md) | **简体中文**

# 为 Observe 贡献

感谢你有兴趣参与贡献。本指南覆盖基础事项。

## 开发环境

```bash
npm install
npm test        # node --test
```

核心需要 Node ≥ 20;可选的 SQLite adapter 及其测试需要 Node ≥ 22(在更旧的运行时
上会自动跳过)。

## 提 PR 之前

跑一遍完整的本地门禁 —— CI 会在 Node 20 / 22 / 24 上执行相同的检查:

```bash
npm run typecheck      # 完整 strict 下的 tsc --noEmit,必须干净
npm run format:check   # prettier
npm run lint           # eslint
npm test               # node --test
npm run build          # 产出 dist/
```

- **类型安全:** 项目开启 `strict`(含 `exactOptionalPropertyTypes`、
  `verbatimModuleSyntax`、`noUncheckedIndexedAccess`)。除非不可避免并加注释,
  不允许 `any` 逃逸。
- **零运行时依赖:** 核心及其 adapter 只用 Node 内置能力(SQLite adapter 用内置的
  `node:sqlite`)。没有非常充分的理由,不要新增运行时依赖。
- **边界就是重点。** Observe 只观察:绝不执行、规划、编排、记忆用户体验或派生组织
  信号。跨越这些边界的 PR,无论质量如何都会被拒绝。
- **测试:** 新行为需要测试,且必须自洽(无网络、独立临时目录、用后清理)。用注入的
  `Clock`(`fixedClock`)保证确定性 —— 断言中绝不使用真实时钟时间。
- **新的存储 adapter?** 用一致性套件证明它:从 `@octopus/observe/conformance`
  调用 `storeConformance("你的后端", { observations: () => fresh() })`。它天生
  对抗 —— 不完整的实现会失败。

## 项目结构

权威的架构、模块地图与边界见 [docs/DESIGN.md](docs/DESIGN.md)。代码依据该规范编写;
契约变化时先更新它。

## 提交 / PR

- PR 保持聚焦。说明改了什么、为什么。
- 面向用户的变更请更新 `CHANGELOG.md`。
- 改动公开 API 或 CLI 界面时,更新相关文档(`README.md`、`docs/`)。文档为双语
  (英文为准 + `*.zh-CN.md` 副本);可行时两者一并更新。

## 报告 Bug / 安全问题

普通 bug 请正常提 issue。安全漏洞请遵循 [SECURITY.md](SECURITY.md),不要提交公开
issue。
