[English](README.md) | **简体中文**

# Observe

[![CI](https://github.com/octoryn/octopus-observe/actions/workflows/ci.yml/badge.svg)](https://github.com/octoryn/octopus-observe/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/octoryn/octopus-observe?sort=semver)](https://github.com/octoryn/octopus-observe/releases/latest)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](.nvmrc)
[![Built on octopus-evidence](https://img.shields.io/badge/built%20on-octopus--evidence-7c9cff.svg)](https://github.com/octoryn/octopus-evidence)

> 独立的观测数据摄取与规范化 (normalization)。Observe 将原始的外部事件转化为
> **可信、规范、不可变的观测记录 (observations)** —— 仅此而已。

> **[Octopus Core](https://github.com/octoryn) 的一部分 —— 受治理 AI 的开源基础设施栈。** 每个仓库只做一件事，沿 agent 生命周期组合：[Scout](https://github.com/octoryn/octopus-scout) · [Observe](https://github.com/octoryn/octopus-observe) · [Experience](https://github.com/octoryn/octopus-experience) · [Blackboard](https://github.com/octoryn/octopus-blackboard) · [Runtime](https://github.com/octoryn/octopus-runtime) · [Replay](https://github.com/octoryn/octopus-replay) —— [Inspect](https://github.com/octoryn/octopus-inspect) 横贯每一环做治理。
>
> **本仓库 —— Observe · 观测：** 把不可信事件变成可信观测。

```
Raw event → Validation → Normalization → Attribution → Deduplication
          → Canonical observation → Storage → Read API
```

将来自任何来源（Git、issue、评审、部署、邮件……）的不可信事件喂给 Observe。
它会校验这些事件，将其规范化 (normalize) 为规范形态，归因 (attribute) 其
参与者 (actor) 与主体 (subject)，以幂等 (idempotent) 方式去重 (deduplicate)，
并存储可供回查的不可变观测记录 —— 同时为每个事件保留一份完整的审计轨迹
(audit trail)，记录它经历了什么。

## 边界 (Boundaries)

Observe **不会**执行动作、规划、编排、记忆用户体验，也不会推导组织层面的信号。
推导信号（评审延迟趋势、所有权漂移、健康度指数）属于消费 Observe 输出的
*下游 (downstream)* 系统。Observe 到规范观测记录为止。

它**不依赖** `octopus-blackboard`、`octopus-experience` 或任何工作流运行时。边界
是 `ObservationEvent` 这一形态 —— 而非任何连接器 SDK。

它具有**零第三方依赖 (zero third-party dependencies)**:唯一的运行时依赖是一方的
[`octopus-evidence`](https://github.com/octoryn/octopus-evidence) 原语(其本身零
依赖),它提供全栈共享的规范化哈希 —— `toEvidence` 桥接器正是用它把一条 observation
投射成一个可验证的 `Evidence` 信封。除此之外本仓库可完全独立使用。

## 安装与构建 (Install & build)

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --test (154 tests)
npm run build       # emit dist/
```

需要 Node ≥ 20。可选的 SQLite 适配器使用 Node 内置的 `node:sqlite`，在
Node ≥ 22 上可用。

默认情况下时间戳 (timestamp) 强制采用带时区偏移的 RFC 3339 格式（这样规范时间
与地区无关）；传入 `timestampPolicy: "lenient"` 可退出此约束。

## 快速上手 (Quickstart)

```ts
import { Observe, exampleValidators } from "octopus-observe";

const observe = new Observe({ validators: exampleValidators });

const result = await observe.ingest({
  eventId: "evt-1",
  envelopeVersion: "1.0",
  schemaVersion: "1.0",
  kind: "review.submitted",
  occurredAt: "2026-07-01T09:30:00.000Z",
  source: { system: "github", version: "2022-11-28" },
  payload: { pullRequest: "octopus-observe#42", decision: "approved", comments: 3 },
  actors: [{ type: "actor", id: "alice" }],
  subjects: [{ type: "pull_request", id: "octopus-observe#42" }],
});

// result.status is "accepted" | "duplicate" | "rejected" | "skipped"
if (result.status === "accepted") {
  console.log(result.observation.id); // obs_<sha256…>, deterministic
}

// Read back, filtered.
const reviews = await observe.read.queryObservations({
  types: ["ReviewSubmitted"],
  order: "asc",
});

// Explain what happened to an event.
const trail = await observe.read.getEventAudit("evt-1");
// → validation/passed → normalization/passed → attribution/passed
//   → dedupe/unique → storage/stored
```

重复摄取 (ingest) 相同的 `eventId` 会返回 `{ status: "duplicate" }` 且不存储任何
新内容 —— 确定性 (deterministic) 的 id 使 ingest 具备幂等性 (idempotent)。

## CLI

```bash
# From a JSON array or NDJSON file, or stdin:
npm run cli -- events.ndjson --audit
cat events.ndjson | npm run cli -- --audit
npm run cli -- --json          # machine-readable output

# After building, the `octopus-observe` bin is available:
octopus-observe events.ndjson
```

若有任何事件被拒绝 (rejected)，退出码为 `1`，否则为 `0`。

## 定义你自己的观测类型 (Defining your own observation types)

一个 `Validator` 拥有一对 `(kind, schemaVersion)`，并将不可信的负载 (payload)
转化为规范属性：

```ts
import { PayloadChecker, type Validator } from "octopus-observe";

const mergeValidator: Validator = {
  kind: "pr.merged",
  observationType: "PullRequestMerged",
  schemaVersion: "1.0",
  validate(payload) {
    const c = PayloadChecker.of(payload);
    if (!c) return { ok: false, issues: [{ path: "payload", message: "must be an object" }] };
    c.string("pullRequest");
    c.number("additions", { optional: true, integer: true });
    return c.result();
  },
};

const observe = new Observe({ validators: [mergeValidator] });
```

## 持久化 (Persistence，SQLite)

核心库自带一个内存存储；一个持久的 SQLite 适配器可从独立的入口点获取（因此导入
核心库时永远不会加载实验性的 `node:sqlite`），且**不增加任何 npm 依赖**：

```ts
import { Observe, exampleValidators } from "octopus-observe";
import { createSqliteStores } from "octopus-observe/sqlite";

const stores = createSqliteStores("./observe.db"); // or ":memory:"
const observe = new Observe({
  validators: exampleValidators,
  observationStore: stores.observations,
  auditStore: stores.audit,
});

// … ingest …
stores.close();
```

稍后重新打开同一个文件，观测记录与审计哈希链 (hash chain) 都会精确地从上次停止
之处恢复。你可以自行为任何其他后端实现 `ObservationStore` / `AuditStore`。

## 防篡改审计 (Tamper-evident audit)

每个事件的审计记录构成一条**哈希链 (hash chain)**（`sequence`、`previousHash`、
`hash`）。任何编辑、插入、删除或重排都会将其打断：

```ts
import { verifyAuditChain, exportAuditNdjson } from "octopus-observe";

const trail = await observe.read.queryAudit();
const check = verifyAuditChain(trail);          // { ok: true } or { ok: false, brokenAt, reason }

const ndjson = exportAuditNdjson(trail);        // ship to a SIEM / log pipeline
```

默认情况下这是**防篡改的 (tamper-evident)**（能检测出随意的/就地的篡改），但并非
防伪造 (tamper-proof) —— 哈希是公开的。对于不信任存储的部署，可传入 `auditSecret`
使该链成为带密钥的 HMAC，没有密钥便无法伪造：

```ts
const observe = new Observe({ validators, auditSecret: process.env.AUDIT_KEY });
// verify with the same key:
verifyAuditChain(await observe.read.queryAudit(), process.env.AUDIT_KEY);
```

## 观测完整性 (Observation integrity)

每条观测记录都携带一个覆盖其内容的 `integrity` 哈希，因此某条已存储的观测记录若
事后被改动（例如直接在数据库中编辑某个属性），是可被检测到的 —— 且独立于确定性
的 `id`：

```ts
import { verifyObservation } from "octopus-observe";

const obs = await observe.read.getObservation(id);
verifyObservation(obs); // false if any field was tampered with
```

与审计链一样，它默认防篡改 (tamper-evident)；向 `Observe` 传入 `integritySecret`
可获得一个带密钥的 HMAC，没有密钥便无法伪造（用同一密钥进行校验）。审计轨迹证明
*发生了什么*；观测完整性证明每一条已存储的事实*未被改动*。

## 原始事件归档 (Raw-event archive，可选)

重新规范化 (re-normalize) 历史数据需要原始事件（观测记录不保留其源负载
(payload)）。可附加一个**可选的** `RawEventArchive` —— 一份忠实记录原始输入的
磁带 (tape)，严格置于观测线之外（无论是否附加归档，产出的观测记录都是逐字节相同
的，且归档只保存原始输入，绝不保存观测记录）：

```ts
import { Observe, InMemoryRawEventArchive } from "octopus-observe";
// or use the durable one: createSqliteStores(...).rawEvents

const archive = new InMemoryRawEventArchive();
const observe = new Observe({ validators, rawEventArchive: archive });
```

由于它是一份可能包含 PII/PHI 的明文磁带，留存 (retention) 是一等公民。
`pruneBefore` 会移除最旧的前缀（对审计安全 —— 它绝不会打出空洞，且序列号
(sequence) 绝不会被重用）：

```ts
// Keep only events at/after a cut sequence (e.g. computed from an age window):
const removed = await archive.pruneBefore(cutSequence);
```

## 回填 / 重新规范化 (Backfill / re-normalization)

观测记录是不可变的，且其 id 以规范化版本 (normalization version) 为范围，因此在
新版本下重新规范化会产生**全新、并存的**观测记录，而非改写历史。`renormalize`
是一个纯粹、可试运行 (dry-runnable) 的原语 —— 将归档（或某个上游来源）重放
(replay) 通过它，然后 `put` 结果：

```ts
import { renormalize } from "octopus-observe";

const archived = await archive.replay();
const { observations, rejections } = renormalize(
  archived.map((e) => e.event),
  { validators, normalizationVersion: "2.0" },
);
```

端到端的形态是 `archive.replay()` → `renormalize` → `store.put`。关于边界纪律与
完整的迁移手册，参见 [`docs/DESIGN.zh-CN.md`](docs/DESIGN.zh-CN.md) §6.1 与 §8.1。

## 验证存储适配器 (Verifying a storage adapter)

要编写你自己的 `ObservationStore` / `AuditStore` / `RawEventArchive`？一套可复用的
一致性套件 (conformance suite) 会证明它满足与内置实现相同的契约 —— 完整记录的往返
(round-trip)、以 AND 组合的过滤器、空存储读取、仅追加 (append-only) 语义，以及对
审计安全的裁剪 (pruning)。在一个 `node --test` 文件中将它指向你的工厂函数：

```ts
import { storeConformance } from "octopus-observe/conformance";
import { MyPostgresObservationStore } from "./my-adapter.js";

storeConformance("postgres", {
  observations: () => new MyPostgresObservationStore(freshTestDb()),
});
```

该套件在设计上是对抗性 (adversarial) 的：一个丢失字段、以 OR 组合过滤器，或对冷
存储处理不当的适配器会直接失败，而不会在覆盖不全的情况下侥幸通过。

## 扩展点 (Extension points)

恰好三个 —— 其余一切皆封闭：

1. **Validators** —— 添加输入 kind / schema 版本。
2. **存储适配器 (Storage adapters)** —— 实现 `ObservationStore` / `AuditStore` /
   可选的 `RawEventArchive`（仓库内自带内存与 SQLite 默认实现）。
3. **Resolver** —— 实现 `Resolver` 以进行跨来源的身份解析（默认为直通身份）。

## 设计 (Design)

权威的架构与契约文档位于 [`docs/DESIGN.zh-CN.md`](docs/DESIGN.zh-CN.md)。在做出更改
之前请先阅读它 —— 代码是依照该规范编写的。

## 许可证 (License)

[Apache-2.0](LICENSE) © Octoryn。
