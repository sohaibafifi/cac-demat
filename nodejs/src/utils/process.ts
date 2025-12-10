import { spawn } from 'child_process';

export interface RunCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  abortSignal?: AbortSignal;
}

export interface RunCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<RunCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let finished = false;
    let timeout: NodeJS.Timeout | undefined;
    const abortSignal = options.abortSignal;

    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
      }

      child.stdout?.off('data', handleStdout);
      child.stderr?.off('data', handleStderr);
      child.off('error', handleError);
      child.off('close', handleClose);
      abortSignal?.removeEventListener('abort', handleAbort);
    };

    const handleStdout = (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      options.onStdout?.(text);
    };

    const handleStderr = (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      options.onStderr?.(text);
    };

    const handleError = (error: Error) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      reject(error);
    };

    const handleClose = (code: number | null) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      resolve({ exitCode: code, stdout, stderr });
    };

    const handleAbort = () => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      child.kill('SIGKILL');

      const reason = (abortSignal as { reason?: unknown } | null | undefined)?.reason;
      const error = reason instanceof Error ? reason : new Error('Command aborted');
      error.name = reason instanceof Error ? reason.name : 'AbortError';
      reject(error);
    };

    child.stdout?.on('data', handleStdout);
    child.stderr?.on('data', handleStderr);
    child.on('error', handleError);
    child.on('close', handleClose);
    abortSignal?.addEventListener('abort', handleAbort);

    if (abortSignal?.aborted) {
      handleAbort();
      return;
    }

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeout = setTimeout(() => {
        if (finished) {
          return;
        }
        child.kill('SIGKILL');
        cleanup();
        reject(new Error(`Command timed out after ${options.timeoutMs}ms: ${command}`));
      }, options.timeoutMs);
    }
  });
}
