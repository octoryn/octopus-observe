[English](CHANGELOG.md) | **简体中文**

# 更新日志

Observe 的所有重要变更均记录于此。格式遵循
[Keep a Changelog](https://keepachangelog.com/)，并且项目计划在达到 1.0 后遵循
语义化版本（semantic versioning）。每个版本在发布前都经过了一次独立的
对抗性（"红队"）评审加固。

## [0.7.0] — 2026-07-02

### Changed
- **许可证改为 AGPL-3.0-or-later**（原为 MIT），与 Octoryn 生态保持一致。若你需要
  用于嵌入的宽松许可证，请在依赖此版本前提出。

### Added
- **开源发布打包（open-source release packaging）**，对齐生态标准：完整的
  `package.json` 元数据（author、repository、homepage、bugs、keywords）、双语文档
  （英文为准 + 带语言切换器的 `*.zh-CN.md` 副本）覆盖 README、CHANGELOG 与设计文档、
  README 徽章，以及 `SECURITY.md` / `CONTRIBUTING.md` / `CODE_OF_CONDUCT.md`。
- **Lint + 格式化工具链：** ESLint（flat config）与 Prettier，配套 `.editorconfig`、
  `.prettierrc.json`、`.nvmrc`，以及 `format` / `format:check` / `lint` 脚本。CI 现在
  在 Node 20 / 22 / 24 上于 typecheck、test、build 之外一并运行 format-check 与 lint。
  `coverage` 脚本使用 Node 内置的测试覆盖率。

## [0.6.0] — 2026-07-02

### Added
- **对抗性边界模糊测试（adversarial boundary fuzzing）。** 一套基于属性（property-based）的测试
  向 `ingest` 灌入数千个恶意/随机输入（畸形信封、非有限数值、`undefined`、
  诸如 `__proto__` 的恶意键、深层嵌套、unicode）——同时覆盖带密钥与不带密钥的情形——
  并断言可信入口层的核心承诺：
  `ingest` 永不抛出（每一种结果都以返回值的形式给出）、每一个被接受的
  观测（observation）都能自我验证（包括在一次 JSON 往返之后）、重复摄入是
  幂等（idempotent）的、审计哈希链在整个恶意测试过程中始终有效，并且
  不存在原型污染（prototype pollution）。测试从固定种子运行，因此任何失败都是
  可复现的。

### Changed
- 将包的 `version` 与更新日志对齐（原为 `0.1.0`），作为首个
  可发布版本。

## [0.5.0] — 2026-07-02

### Added
- **观测内容完整性（content integrity）。** 每个观测现在都携带一个
  覆盖其全部内容的 `integrity` 哈希，因此一个在存储后被
  篡改的观测（例如某个属性被直接在数据库中修改）可以
  通过 `verifyObservation(obs, secret?)` 检测出来——且独立于
  确定性的 `id`。可选的带密钥 HMAC（`Observe` / `renormalize` 上的 `integritySecret`）
  可将其从防篡改（tamper-evidence）升级为抗篡改（tamper-resistance），与
  审计链的模型保持一致。这使得观测本身成为可自我验证的，
  从而补全了整个信任叙事（关于它们*本身*的审计轨迹此前已经是
  防篡改的）。`computeObservationHash` / `verifyObservation` 已导出；
  它们的编码是一份冻结的线上契约（wire contract）。

## [0.4.0] — 2026-07-02

### Added
- **存储一致性测试套件（storage conformance suite）**（`@octopus/observe/conformance`）：一套可复用的、
  对抗性的针对 `ObservationStore` / `AuditStore` /
  `RawEventArchive` 的契约测试组，任何第三方适配器都可以借此证明其对等性，而无需
  被无条件信任。可在仓库内针对内存后端与 SQLite 后端运行。

### Changed
- 内存审计存储现在强制 id 唯一性（与 SQLite 的
  `UNIQUE(id)` 一致），因此只追加（append-only）语义在各后端间完全相同。

### Notes
- 一致性测试套件在其自身的多智能体（multi-agent）评审发现 12 处
  覆盖缺口（仅有单过滤器测试、缺少字段保真度的深度相等性检查、缺少
  空存储或 `receivedAt` 检查……）后得到了加固。它现在会对完整记录进行往返、
  演练 AND 组合过滤器、空存储读取以及只追加值的存续性——并
  经过验证能够对*故意破坏*的适配器给出失败结果，而不仅仅是让正确的适配器通过。

## [0.3.0] — 2026-07-02

### Added
- **留存 / 擦除（retention / erasure）** 作为一等 API：`RawEventArchive.pruneBefore(sequence)`
  会移除磁带（tape）最旧的前缀，并返回被裁剪掉的事件数量。
  它被刻意设计为**仅限前缀**（不支持谓词/任意删除），从而保留
  磁带的审计语义——余下部分仍然是一个有序后缀，
  越过裁剪点之前的 `fromSequence` 书签仍然有效，且序号永不
  被复用。这为可能保存 PII/PHI 的明文归档提供了一条干净的留存
  路径。已针对内存归档与 SQLite 归档两者实现。
- `assertValidPruneSequence` 守卫，与其他查询守卫一并导出。
- **CI**（`.github/workflows/ci.yml`）覆盖 Node 20/22/24，运行类型检查、
  测试与构建。

### Changed
- SQLite 适配器现在**惰性加载（lazily loads）** `node:sqlite`（在模块作用域仅做
  类型导入）。在不具备该模块的运行时（Node < 22.5）上导入
  `@octopus/observe/sqlite` 不再在加载时抛出——错误仅在创建存储
  时才浮现——因此完整测试套件可在 Node 20 上运行，同时 SQLite 测试组
  自动跳过。

## [0.2.0] — 2026-07-02

### Added
- **可选的原始事件归档（raw-event archive）**（`RawEventArchive` 端口）——一条忠实的、
  只追加的原始输入磁带，用作回填（backfill）来源。严格置于
  观测主线之外：挂接归档永远不会改变所产生的观测（逐字节相同），
  它仅保存原始输入，而一次失败的归档写入是一个
  基础设施错误，不会在下游存储任何内容。提供内存与 SQLite
  实现；`createSqliteStores` 会返回一个归档。

### Fixed (red-team)
- SQLite 归档序号使用 `AUTOINCREMENT`（永不复用，在
  裁剪下安全），而非一个由 `COUNT(*)` 派生的键——后者可能卡死或复用。
- `replay()` 会校验其边界（`assertValidReplayQuery`），因此各后端不再
  对畸形的 `limit` / `fromSequence` 产生分歧。

## [0.1.0] — 2026-07-02

### Added
- **SQLite 持久化适配器**（`@octopus/observe/sqlite`），基于 Node 内置的
  `node:sqlite`——零 npm 依赖，与核心入口隔离。
- **严格的 RFC 3339 时间戳**，默认要求强制的时区偏移量
  （与地域无关的规范化 `at`）；提供 `"lenient"` 退出选项。
- **回填原语（backfill primitive）** `renormalize()`——纯粹的、可试运行（dry-runnable）的重新规范化，
  会产出全新的、版本受限的、可共存的观测。
- **防篡改（tamper-evident）审计哈希链**（`verifyAuditChain`），带一个可选的
  带密钥 HMAC 模式（`auditSecret`）以实现抗篡改，以及 `exportAuditNdjson`
  用于 SIEM 摄取。

### Fixed (red-team)
- 严格时间戳解析器会校验字段范围并直接计算时刻——
  没有 `Date.parse` 的溢出翻转（例如 Feb 30 会被拒绝，而不是被平移）。
- 单射的（injective）观测 id 哈希；审计存储上的只追加强制约束。

## [0.0.0] — 2026-07-02 (v0)

### Added
- 核心接入与规范化流水线：原始事件 → 校验 →
  规范化 → 归因 → 去重 → 规范观测 → 存储
  → 读取 API。
- 不可变、深度冻结的观测，带确定性 id（幂等
  重复摄入）；校验是唯一的拒绝阶段；完整的逐事件审计
  轨迹；可插拔存储并带内存默认实现；示例校验器、一个 CLI
  以及设计文档。
