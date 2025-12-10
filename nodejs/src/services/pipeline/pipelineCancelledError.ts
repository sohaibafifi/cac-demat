export class PipelineCancelledError extends Error {
  constructor(message = 'Pipeline arrêté.') {
    super(message);
    this.name = 'PipelineCancelledError';
  }
}

export function isPipelineCancelledError(error: unknown): error is PipelineCancelledError {
  return error instanceof PipelineCancelledError;
}

export function throwIfPipelineCancelled(signal?: AbortSignal): void {
  if (!signal || !signal.aborted) {
    return;
  }

  const reason = (signal as { reason?: unknown }).reason;
  if (reason instanceof Error) {
    throw reason;
  }

  throw new PipelineCancelledError();
}
