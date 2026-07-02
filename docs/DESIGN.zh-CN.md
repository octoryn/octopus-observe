[English](DESIGN.md) | **简体中文**

# Observe — 架构与契约

状态：**v0.1** · 负责方：Observe · 最后更新：2026-07-02

这是权威设计文档。代码是*依据*本规范编写的。当二者出现分歧时，在本文档更新之前，应视其为文档有误——先在此处修正，再改动代码。

---

## 1. Observe 是什么

**Observe 将原始的外部事件转化为可信、规范、不可变的观测 (observation)。** 这就是全部的北极星目标。

```
Raw event → Validation → Normalization → Attribution → Deduplication
          → Canonical observation → Storage → Read API
```

一个外部连接器 (connector)（它**不**位于本仓库中）把某个上游发生的事件映射成一个 `ObservationEvent`，并交给 Observe。从这个边界向内，Observe 对其进行校验、将其规范化 (normalization) 为规范形态、对其参与者 (actor) 与主体 (subject) 进行归因 (attribution)、去重 (deduplication)，并存储一条不可变的 `Observation`，该记录可通过查询 API 读回——并附带一份完整的审计轨迹 (audit trail)，记录每个事件所经历的一切。

### 1.1 它*不是*什么（强制边界）

Observe 不做、也绝不能做以下这些事：

- **执行 (Execute)** 动作或引发任何外部副作用。
- **规划 (Plan)** ——没有目标、下一步或工作流。
- **编排 (Orchestrate)** ——没有智能体、路由或协调。
- **记忆用户体验 (Remember user experience)** ——它存储观测及其审计轨迹；那是一份仅追加 (append-only) 的记录，而非对交互的记忆。
- **推导组织信号 (Derive organizational signals)** ——计算评审延迟趋势、所有权漂移、健康指数等是*下游 (downstream)* 的职责。Observe 止步于规范观测。（信号推导是一个消费 Observe 输出的独立系统；它不在此处范围内。）

如果某个拟议的功能需要上述任何一项，那么它就不属于本仓库。

### 1.2 独立性

对 `octopus-blackboard`、`octopus-experience` 或任何工作流运行时零依赖——事实上，**完全没有任何运行时依赖**。该包在没有任何其他东西存在的情况下，就能全内存地完成构建、测试与端到端运行。集成是操作系统 (operating system) 的职责；边界是 `ObservationEvent`，而非任何连接器 SDK。

---

## 2. 流水线

每个阶段都是一条单向边界。数据只向前流动；下游的任何东西都不会回写上游。

| Stage             | Input → Output                     | Responsibility                                                        |
|-------------------|------------------------------------|-----------------------------------------------------------------------|
| **Validation**    | `unknown` → structural event       | 信封 (envelope) 形态、信封版本、kind+schema 查找、payload、时间戳。**唯一被允许拒绝的阶段。** |
| **Normalization** | event → canonical fields           | 规范类型、时间戳 → epoch 毫秒、版本标记、确定性 id。 |
| **Attribution**   | raw refs → tagged refs             | 将 actors/subjects 解析为规范 refs（可插拔；默认恒等）。 |
| **Deduplication** | observation → unique?              | 确定性 id 查找；对同一事件的重新摄入是幂等 (idempotent) 的。   |
| **Storage**       | observation → persisted            | 仅追加持久化（可插拔；默认内存）。               |
| **Read API**      | query → observations / audit       | 对已存储观测与审计轨迹的只读访问。          |

校验、规范化与归因作为一个纯粹步骤实现（`Normalizer`），依赖以注入方式提供；去重、存储与审计发出 (audit emission) 由 `Observe` 流水线编排。每一次阶段转换都会发出一条审计记录（§7）。

---

## 3. 核心概念

一条严格的双记录演进：**Event → Observation**。

### 3.1 ObservationEvent — 不可信输入

位于边界处的原始记录。它已由连接器映射进 Observe 的信封 (envelope) 形态，但仍不可信：它可能格式错误、重复、乱序、携带不受支持的版本，或引用未知的 kind。

契约（见 `src/core/event.ts`）：`eventId`、`envelopeVersion`、`schemaVersion`、`kind`、`occurredAt`、`payload`，外加可选的 `source`、`actors`、`subjects`。`payload` 的类型为 `unknown`——它只由校验器 (validator) 解释。

`occurredAt` 必须是一个**带有显式时区偏移**的 RFC 3339 时间戳（例如末尾的 `Z` 或 `±HH:MM`）。这是默认强制的（`timestampPolicy: "rfc3339"`）：一个不带偏移的日期时间会按 JS 运行时进行解释，因而在不同机器或地区之间并非规范一致的——这对审计与合规至关重要，因此会被拒绝为 `INVALID_TIMESTAMP`。可以选用 `"lenient"` 策略作为一种显式的退出选项，供那些明知要摄入更宽松来源的流水线使用。

### 3.2 Observation — 可信、规范、不可变

流水线的输出（见 `src/core/observation.ts`）。关键属性：

- **不可变 (Immutable)。** 在创建时被深度冻结 (deep-frozen)。更正以新事件的形式到来，并成为新的观测；记录是仅追加的。
- **确定性 id。** `id = sha256(sourceEventId, type, normalizationVersion)`。在同一规范化版本下重新摄入同一事件会得到相同的 id（幂等去重）；提升规范化版本会得到一个*新的* id（重新推导，绝不原地修改）。
- **已归因 (Attributed)。** `actors` 与 `subjects` 被解析为规范的 {@link TaggedRef}，以便下游消费者能跨来源聚合。
- **带版本 (Versioned)。** 携带产生它的信封、schema、规范化以及（可选的）source 版本。

### 3.3 开放的 tagged refs

Observe 从不枚举 actor/subject 种类的集合——那会把核心耦合到某一个组织的词汇上。一个 ref 是一个开放的 `(type, id)` 对：`type` 命名其种类（"actor"、"team"、"service"、"pull_request"……），`id` 在该种类内标识它。消费者基于 `type` 进行匹配。

### 3.4 观测完整性 (integrity)

确定性 `id` 建立的是*身份 (identity)*（用于去重），而非*完整性 (integrity)*：它是 `(sourceEventId, type, normalizationVersion)` 的函数，因此如果有人直接在数据库中编辑了一条已存储观测的某个属性，它并不会改变。为弥补这一缺口，每条观测还携带一个 `integrity` 哈希，覆盖其**全部**内容（除 `integrity` 自身之外的每一个字段），在摄入时计算，并以与键顺序无关的方式序列化（`stableStringify`），使其在存储往返 (round-trip) 中保持稳定，但对任何取值变化都敏感。`verifyObservation(obs, secret?)` 会重新计算并比对。

这映照了审计链的信任模型（§7.1）：不加密钥时，它是**防篡改可检测 (tamper-evident)** 的（可检出任何未重新计算之人所作的编辑/损坏）；提供一个 `integritySecret`，哈希就变为一个带密钥的 HMAC，没有密钥便无法伪造——**抗篡改 (tamper-resistant)**。审计轨迹证明一个事件*经历了什么*；观测完整性证明每一条已存储的事实*未被更改*。`computeObservationHash` / `stableStringify` 是冻结的线缆契约 (wire contracts)。该哈希覆盖 `ingestedAt`，因此在不同时钟下重新规范化同一事件会得到不同的 integrity——这是预期的，因为 `ingestedAt` 是记录的一部分，而 `verifyObservation` 始终使用已存储的值。

---

## 4. 校验 (Validation)

不可信外部与可信内部之间的边界，也是**唯一**被允许拒绝的阶段。每一次拒绝都携带一个结构化的 `RejectionReason`：

| Reason                          | Meaning                                                     |
|---------------------------------|-------------------------------------------------------------|
| `MALFORMED_ENVELOPE`            | 不是一个格式良好的 `ObservationEvent`。                       |
| `UNSUPPORTED_ENVELOPE_VERSION`  | 本次构建不理解该 `envelopeVersion`。             |
| `UNKNOWN_KIND`                  | 没有为该 `kind` 注册的校验器。                     |
| `SCHEMA_VERSION_MISMATCH`       | kind 已知，但不适用于该事件的 `schemaVersion`。        |
| `INVALID_TIMESTAMP`             | `occurredAt` 无法被解析。                              |
| `INVALID_PAYLOAD`               | Payload 未通过该类型的校验器（附带问题项）。      |

拒绝是**被返回的，绝不抛出**，并且总是镜像进审计轨迹。未知 kind 默认被拒绝；对于混合的高流量数据流 (firehose)，可选用 `skip` 策略（记入审计，不产生拒绝）。

一个**校验器 (Validator)** 拥有一个 `(kind, schemaVersion)` 对，并且是纯粹的：给定一个不可信的 payload，它返回规范属性或字段级的问题项。它不解析 refs、不读取时钟、也不触碰存储。新增一种输入 kind = 注册一个校验器。这是输入侧的扩展点。

---

## 5. 归因 (Attribution)

将原始 refs 解析为规范的 tagged refs——这是跨来源身份解析（例如把 `github:alice` 与 `email:alice@corp` 统一起来）会驻留的接缝处。解析是纯粹且完备 (total) 的：它总是返回一个 ref，对普通输入从不抛出；未知身份直接透传。默认的 `identityResolver` 是透传式的，使 Observe 在独立使用时依然完全可用。

---

## 6. 存储 (Storage)

接口背后有两个仅追加存储（见 `src/storage/store.ts`）：

- `ObservationStore` — `has` / `put` / `get` / `query` / `count`。对一个已存在的 id 执行 `put` 是一次仅追加违规并会抛出（流水线会先去重，所以这只在编程错误时才触发）。
- `AuditStore` — `append` / `list`。

内存实现随仓库一同发布，且是**一等公民**，而非测试替身——正是它们让 Observe 在没有任何外部依赖时也能使用。`ObservationQuery` 支持按类型（一个或多个）、时间窗口（`from` 包含、`to` 不包含）、actor/subject ref 过滤，外加排序与限量；格式错误的边界（`NaN` / 负 limit）会被高声拒绝，而不是悄悄返回错误结果（`assertValidObservationQuery`，由所有适配器共享）。

一个 **SQLite 适配器**随仓库一同发布，位于 `@octopus/observe/sqlite` 入口点（`createSqliteStores(location)`）。它构建在 Node 内置的 `node:sqlite` 之上，因此**不增加任何 npm 依赖**；该模块是实验性的，且仅在导入此适配器时才加载，从而使核心入口不受其牵累。它保留了每一条不变量：仅追加（对已存在 id 的 `put` 会抛出）、不可变（观测在读取时被深度冻结）、审计记录按追加顺序返回，从而使哈希链（§7）在进程重启之间保持可验证。更多后端（Postgres……）都是满足相同接口的适配器。

### 6.1 原始事件归档 (Raw-event archive)（可选、独立端口）

`RawEventArchive` 是一个**可选**端口，与观测存储和审计存储相互独立。它是一份忠实的、仅追加的**原始输入磁带 (tape)**，正如在边界处所接收的那样——不可信、未规范化、按到达顺序排列。它的唯一目的是为回填 (backfill)（§8.1）提供原始事件的来源，因为一条 `Observation` 并不保留其来源 payload。

边界纪律——归档绝不能污染观测线：

- 归档保存**原始输入**，绝不保存规范观测。二者从不混用类型或数据表。
- 附加一个归档**不会改变 Observe 所产生的观测**——无论有没有它，观测都是逐字节相同的（有测试验证）。归档是先行写入的，纯粹作为一条旁路。
- 归档**不做任何规范化**。重放的事件会重新经过 `renormalize`；归档是"哑"存储。
- 一次失败的归档写入是一个基础设施错误（§9.3），会浮现给调用方，因此在存储一条观测的同时，磁带绝不会被悄悄跳过。

内存与 SQLite 实现随仓库一同发布；`createSqliteStores` 会在返回观测存储与审计存储的同时返回一个归档，三者共享连接。

属性与运维注记：

- **Sequence** 是一个单调递增、唯一、不透明的序数（内存实现从 0 开始，SQLite 经由 `AUTOINCREMENT` 从 1 开始）。它**绝不重用**，即便在行被剪除 (prune) 之后也是如此，因此书签 (`fromSequence`) 绝不会悄悄跳过或重复计数。不要假设某个起始值或无间隙性。
- **忠实副本。** 事件以 JSON 副本形式存储，免受后续调用方修改的影响；两种后端都使用相同的 `JSON.stringify` 语义。因此输入必须是可 JSON 序列化的——一个不可序列化的输入（一个 `bigint`、一个循环对象）会作为基础设施错误使归档失败，而不是被有损地存储。
- **合规面与留存 (retention)。** 与审计链不同（审计链存储原因/细节，绝不存储 payload），归档是一份**原始输入的完整明文磁带**——它可能包含 PII/PHI 或密钥。附加一个归档会改变部署的数据留存画像：请按策略施加加密/访问控制。留存/擦除是一个**一等操作**：`pruneBefore(sequence)` 移除最旧的前缀并返回被剪除的数量。它在设计上仅限前缀（绝非中间切片），因而保留了磁带的审计语义——其余部分仍是一个有序的后缀，切口之后的书签依旧有效，而绝不重用的 sequence 意味着剪除只留下无害的间隙，绝不会卡死未来的追加。任意/谓词式删除是有意不提供的。通过读取 `replay()` 找到切口 sequence，再调用 `pruneBefore`，即可构建一个策略（按年龄或数量）。否则增长是无界的（每个摄入事件一个 payload，包括被拒绝的事件）。

---

## 7. 审计 (Audit)

每个事件都会产生一条轨迹，使得"事件 X 经历了什么？"始终有答案。审计记录（见 `src/core/audit.ts`）会为以下情况发出：

- **被接受的事件：** `validation/passed → normalization/passed → attribution/passed → dedupe/unique → storage/stored`
- **重复事件：** `validation/passed → dedupe/duplicate`（无存储；重复项在去重处被短路，因此一个被重投递事件的轨迹保持有界，而不是每次都重新发出完整的接受序列）
- **被拒绝的事件：** `validation/failed → rejection/rejected`
- **被跳过的未知 kind：** `validation/skipped`

审计记录是*关于流水线自身*的仅追加日志。它们不携带任何建议。当一个信封损坏到无法携带 `eventId` 时，其审计记录使用哨兵事件 id `<unknown>`。

### 7.1 防篡改可检测 (Tamper-evidence)

审计记录构成一条**哈希链 (hash chain)**。每条记录携带 `sequence`（从 0 开始的位置）、`previousHash`（前一条记录的 `hash`，或对第一条而言为 `GENESIS_HASH`），以及 `hash`——它覆盖记录内容（与键顺序无关）外加其 `previousHash`。任何编辑、插入、删除或重排都会破坏该链：`verifyAuditChain(records)` 会重新计算每一个哈希，并检查 sequence 的连续性与链接的连贯性，返回第一个失败的索引。

该链由单一的审计写入路径 (`AuditEmitter`) 维护：各次发出被串行化，因此在并发摄入下链依然是良构的；链头在首次使用时**从存储的尾部播种 (seeded)**，因此一个附加到已持有记录的存储（例如在 SQLite 上重启之后）的发送器会延续既有链，而不是分叉它。一次失败的追加不会推进链，因此不会留下间隙。各存储各自独立地强制执行仅追加排序（内存存储要求 sequence 前进；SQLite 对审计 `id` 与 `sequence` 设有 `UNIQUE` 约束），因此一条真正分叉的链——例如两个从同一尾部播种的发送器——会高声失败，而不是悄悄地损坏轨迹。

**信任模型。** 默认情况下哈希是纯 SHA-256，这使得该链**防篡改可检测，而非防篡改不可攻破 (tamper-proof)**：它能可靠地检出任何未重新计算链之人所作的原地编辑、重排与删除，但由于哈希函数是公开的，一个拥有写入权限并掌握代码的对手可以伪造一条内部自洽的链。对于不信任存储的部署，可传入一个 `auditSecret`：哈希变为带密钥的 HMAC-SHA256，没有密钥便无法复现——因而无法伪造一条链（用同一密钥验证）。此外，链头哈希 (`records.at(-1)?.hash`) 可以定期锚定 (anchor) 到一个外部信任边界中。`computeAuditHash`、`stableStringify` 与 `GENESIS_HASH` 是**冻结的线缆契约**：它们的确切输出是审计格式的一部分，因此在一次构建下被哈希的记录能在另一次构建下重新验证。

### 7.2 导出 (Export)

`exportAuditNdjson(records)` 将一条轨迹序列化为以换行分隔的 JSON (NDJSON)，这是把数据送入 SIEM 或日志流水线的通用语言。哈希链字段随每条记录一同传输，因此目的地可以用 `verifyAuditChain` 重新验证完整性。传输（到 SIEM、对象存储等）位于核心之外——Observe 发出字节；它不把它们推送到任何地方。

---

## 8. 版本管理与 schema 演进

四条相互独立的版本轴，使得演进是可审计的，而非破坏性的：

- **信封版本 (Envelope version)** (`ObservationEvent.envelopeVersion`) ——信封的形态。校验基于它进行分派；可以同时接受多个版本。
- **Schema 版本 (Schema version)** (`ObservationEvent.schemaVersion`) ——某个 kind 的 payload 形态。校验器以 `(kind, schemaVersion)` 为键，因此同一 kind 的多个 schema 版本可以共存。
- **规范化版本 (Normalization version)** ——由 Observe 拥有，标记在每一条观测上，并且是确定性 id 的一部分。提升它会在新 id 下重新推导观测，而不是修改既有的（不可变的）观测。
- **Source 版本 (Source version)** (`ObservationEvent.source.version`) ——上游系统的版本，对 Observe 而言不透明，仅为审计而记录。

不变量：记录是不可变的，id 是确定性的，且每条观测都指明了产生它的确切契约版本。演进通过追加新版本的记录发生，绝不通过修改旧记录。

### 8.1 迁移、回填 (backfill) 与重新规范化 (re-normalization)

因为观测是不可变的、且其 id 以规范化版本为范围划定，"改变我们规范化的方式"绝不是一次原地编辑。操作手册如下：

- **新增一个 `kind` 或一个新的 `schemaVersion`** 是纯增量的——注册一个校验器即可。既有观测不受影响；新事件流经新校验器。无需迁移。
- **改变一个既有 `kind` 的规范化方式**是一次**规范化版本提升 (bump)**。发布新版本的规范化器；从那时起，新事件在新版本下产生观测。旧观测保持有效、不可变，并被标记为旧版本。
- **回填 (Backfill)**（在新版本下重新推导历史）是一次显式的、可审计的动作，而非一次自动重写。因为一条 `Observation` 并不保留其来源 payload，回填需要**原始事件**——如果附加过可选的 `RawEventArchive`（§6.1），则来自它，或从上游重放。把它们喂给 `renormalize(events, { normalizationVersion, ... })`，这是一个纯粹、无存储、可试运行 (dry-runnable) 的过程，返回新的观测（带有新的、以版本为范围的 id）以及任何拒绝项。然后 `put` 它们：它们与旧版本观测**共存**，而不是覆盖它们。端到端的形态是 `archive.replay()` → `renormalize` → `store.put`。
- **跨版本读取。** 由于两个版本的观测共享 `sourceEventId` 与 `type`，但在 `id` 与 `versions.normalization` 上不同，读取方可以选择要查阅哪个规范化版本；切换 (cutover) 是一项读取方策略，旧记录可按运维方的日程退役。

该设计有意把重新规范化保持在自动摄入*之外*：一次悄悄重写历史的回填会违反不可变性，并让审计轨迹说谎。Observe 给你原语 (`renormalize`) 与保证（新 id、共存、来源溯源）；一次迁移的编排则是一项运维决策。

---

## 9. 有意为之的边界与限制

为 v0 所作的选择，记录在案以使其保持有意为之：

1. **时间戳 (Timestamps)** 默认被强制为带强制时区偏移的 RFC 3339（§3.1），因此规范的 `at` 值是与地区无关的。`"lenient"` 策略是一个显式的、有文档记录的退出选项；请在知情的情况下使用它。
2. **单写入者假设 (Single-writer assumption)。** `ingest` 可以安全地被顺序调用（并且 `ingestAll` 为去重的确定性保证顺序）。内存存储并非为对*同一*事件 id 的并发 `ingest`（在途中）而设计的；SQLite 适配器的 `UNIQUE` 约束使得重复的 `put` 原子性地失败，但一个跨进程的、完全并发安全的 check-then-write 需要一个适配器层的 upsert。审计发送器串行化其自身的写入，因此在进程内的并发摄入下哈希链是安全的。
3. **基础设施错误 vs 输入拒绝。** 每一个*输入级*的结果都作为一个 `IngestResult`（`accepted` / `duplicate` / `rejected` / `skipped`）返回——一个坏事件绝不会被抛出。如果一个存储或审计*适配器*抛出（磁盘满、连接丢失、仅追加违规），`ingest` 仍可能拒绝其 promise。这被有意保持区分：把一次基础设施故障报告为一个 `rejected` 输入，会错误地告诉调用方该事件是无效的。适配器故障应由调用方处理或重试。
4. **审计记录 id** 是随机 UUID（审计是一份日志，不以 id 寻址）；只有观测 id 才是确定性的。完整性由哈希链（§7.1）保证，而非由 id 保证。
5. **属性是 JSON。** 观测属性与审计细节是纯 JSON，因此观测保持可序列化、可比较且与存储无关。

---

## 10. 模块布局

单一包，`@octopus/observe`。每个模块一项职责；依赖向内指向 `core`，而 `core` 没有依赖。

```
src/
  core/          # domain types & pure helpers — no I/O
    event.ts         # ObservationEvent (untrusted input)
    observation.ts   # Observation (canonical output)
    refs.ts          # open tagged refs
    json.ts          # JSON value model
    rejection.ts     # rejection reasons & issues
    audit.ts         # audit record types
    result.ts        # Result type
    versions.ts      # version constants
    ids.ts           # deterministic observation id
    clock.ts         # injectable clock
    freeze.ts        # deep freeze
    audit-chain.ts   # hash-chain compute & verify
  validate/      # the input-side extension point
    validator.ts     # Validator interface
    registry.ts      # (kind, schemaVersion) registry
    checker.ts       # dependency-free payload checker
  normalize/     # envelope parsing, attribution, normalization
    envelope.ts
    resolver.ts      # attribution seam (default identity)
    timestamp.ts     # RFC 3339 timestamp policy
    normalizer.ts    # validation + normalization + attribution
  storage/       # interfaces + adapters
    store.ts         # interfaces + shared query validation
    memory.ts        # in-memory default
    sqlite.ts        # SQLite adapter (@octopus/observe/sqlite)
  audit/
    emitter.ts       # stamps, hash-chains & writes audit records
    export.ts        # NDJSON / SIEM export
  api/
    read.ts          # read-only query API
  observations/  # example validators (illustrative, not canonical)
  migrate.ts     # renormalize (backfill primitive)
  observe.ts     # the Observe pipeline (orchestration)
  cli.ts         # runnable CLI
  index.ts       # public surface (core; SQLite is a separate entry point)
```

---

## 11. 扩展点

恰好三个，不多不少。其余一切都是封闭的。

1. **校验器 (Validators)** (`validate/`) ——新增一种输入 kind / schema 版本。
2. **存储适配器 (Storage adapters)** (`storage/store.ts`) ——为观测存储、审计存储以及可选的 `RawEventArchive` 端口替换持久化。任何适配器都能用可复用的一致性套件 (conformance suite) (`@octopus/observe/conformance`) 证明它满足契约——内存与 SQLite 后端都通过该套件；它是对抗性的（全记录保真、AND 过滤、空存储读取、仅追加存活性），因此不完整的实现会失败。
3. **解析器 (Resolver)** (`normalize/resolver.ts`) ——跨来源身份解析。

连接器 (Connectors) 在此明确*不是*扩展点；它们位于仓库之外。边界是 `ObservationEvent`。
