// Custom error classes for the Mycelium MVP.
// All errors extend MyceliumError so callers can catch with a single type.

export class MyceliumError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'MyceliumError';
    // Restore prototype chain (required for extending built-in Error in TypeScript)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─── Identity errors ───────────────────────────────────────────────────────────

export class InvalidDIDError extends MyceliumError {
  constructor(did: string) {
    super('INVALID_DID', `Invalid DID format: "${did}". Expected "did:key:z6Mk..."`);
    this.name = 'InvalidDIDError';
  }
}

export class SignatureVerificationError extends MyceliumError {
  constructor(did: string) {
    super('SIG_VERIFY_FAILED', `Signature verification failed for DID: "${did}"`);
    this.name = 'SignatureVerificationError';
  }
}

// ─── Repository errors ─────────────────────────────────────────────────────────

export class RecordNotFoundError extends MyceliumError {
  constructor(collection: string, rkey: string) {
    super('RECORD_NOT_FOUND', `Record not found: ${collection}/${rkey}`);
    this.name = 'RecordNotFoundError';
  }
}

export class SchemaValidationError extends MyceliumError {
  readonly details: unknown;

  constructor(collection: string, details: unknown) {
    super('SCHEMA_VALIDATION', `Schema validation failed for collection "${collection}"`);
    this.name = 'SchemaValidationError';
    this.details = details;
  }
}

export class ImportVerificationError extends MyceliumError {
  readonly commitSeq: number;

  constructor(commitSeq: number, reason: string) {
    super('IMPORT_VERIFY_FAILED', `Import verification failed at commit seq ${commitSeq}: ${reason}`);
    this.name = 'ImportVerificationError';
    this.commitSeq = commitSeq;
  }
}

// ─── Task lifecycle errors ─────────────────────────────────────────────────────

export class InvalidStateTransitionError extends MyceliumError {
  constructor(current: string, next: string, taskUri: string) {
    super(
      'INVALID_TRANSITION',
      `Invalid task state transition: "${current}" → "${next}" for task ${taskUri}`,
    );
    this.name = 'InvalidStateTransitionError';
  }
}

export class TaskNotFoundError extends MyceliumError {
  constructor(taskUri: string) {
    super('TASK_NOT_FOUND', `Task not found: ${taskUri}`);
    this.name = 'TaskNotFoundError';
  }
}

export class UnauthorizedError extends MyceliumError {
  constructor(did: string, resource: string) {
    super('UNAUTHORIZED', `Agent "${did}" is not authorized to modify "${resource}"`);
    this.name = 'UnauthorizedError';
  }
}

// ─── Firehose errors ───────────────────────────────────────────────────────────

export class SubscriptionNotFoundError extends MyceliumError {
  constructor(subscriptionId: string) {
    super('SUB_NOT_FOUND', `Subscription not found: "${subscriptionId}"`);
    this.name = 'SubscriptionNotFoundError';
  }
}
