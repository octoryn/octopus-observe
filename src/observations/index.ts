import type { Validator } from "../validate/validator.js";
import { reviewSubmittedValidator } from "./review-submitted.js";
import { deployFinishedValidator } from "./deploy-finished.js";
import { issueOpenedValidator } from "./issue-opened.js";

export { reviewSubmittedValidator } from "./review-submitted.js";
export { deployFinishedValidator } from "./deploy-finished.js";
export { issueOpenedValidator } from "./issue-opened.js";

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
