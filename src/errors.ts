export class VoxpipeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoxpipeError";
  }
}

export class AuthError extends VoxpipeError {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export function isRetryableStatus(status?: number): boolean {
  if (status === undefined) return true;
  return status === 429 || status >= 500;
}

export class BackendError extends VoxpipeError {
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, options: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = "BackendError";
    this.status = options.status;
    this.retryable = options.retryable ?? isRetryableStatus(options.status);
  }
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof BackendError) return error.retryable;
  return false;
}
