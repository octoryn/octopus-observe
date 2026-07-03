import type { Validator } from "../validate/validator.js";
import { reviewSubmittedValidator } from "./review-submitted.js";
import { deployFinishedValidator } from "./deploy-finished.js";
import { issueOpenedValidator } from "./issue-opened.js";
import { agentToolCalledValidator } from "./agent-tool-called.js";
import { agentActionValidator } from "./agent-action.js";

export { reviewSubmittedValidator } from "./review-submitted.js";
export { deployFinishedValidator } from "./deploy-finished.js";
export { issueOpenedValidator } from "./issue-opened.js";
export { agentToolCalledValidator } from "./agent-tool-called.js";
export { agentActionValidator } from "./agent-action.js";

/**
 * The bundled example validators. These are illustrative reference types, not a
 * canonical vocabulary — real deployments register their own. They exist so the
 * package is runnable and testable out of the box.
 */
export const exampleValidators: readonly Validator[] = [
  reviewSubmittedValidator,
  deployFinishedValidator,
  issueOpenedValidator,
];

/**
 * Validators for the agent-stack event kinds produced by the
 * {@link ../connectors/agent-events.js} adapters (`agent.tool_called` and
 * `agent.action`). Register these when ingesting agent events so the adapter
 * output is accepted rather than rejected as an unknown kind. They are kept
 * separate from {@link exampleValidators} so the illustrative bundle stays
 * unchanged; combine them explicitly, e.g.
 * `[...exampleValidators, ...agentEventValidators]`.
 */
export const agentEventValidators: readonly Validator[] = [
  agentToolCalledValidator,
  agentActionValidator,
];
