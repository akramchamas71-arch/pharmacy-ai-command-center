/**
 * A rule the request violated (not a server fault) — e.g. "can't hard-delete a branch that
 * still has inventory." Routes catch this and respond 409/400 with `.message` as-is; any
 * other thrown error is an unexpected failure and gets a generic 500.
 */
export class BusinessRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessRuleError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
