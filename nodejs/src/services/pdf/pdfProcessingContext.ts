export class PdfProcessingContext {
  temporaryPaths: string[];
  password: string | null;
  useDefaultLogging: boolean;

  constructor(
    public workingPath: string,
    public readonly relativePath: string,
    public readonly recipient: string,
    public readonly targetDirectory: string,
    public readonly basename: string,
    options?: {
      temporaryPaths?: string[];
      password?: string | null;
      useDefaultLogging?: boolean;
    },
  ) {
    this.temporaryPaths = options?.temporaryPaths ? [...options.temporaryPaths] : [];
    this.password = options?.password ?? null;
    this.useDefaultLogging = options?.useDefaultLogging ?? true;
  }

  targetPath(): string {
    return `${this.targetDirectory}/${this.basename}`;
  }

  withWorkingPath(path: string, temporary = true): PdfProcessingContext {
    const clone = this.clone();
    if (temporary && !clone.temporaryPaths.includes(path)) {
      clone.temporaryPaths.push(path);
    }

    clone.workingPath = path;
    return clone;
  }

  withPassword(password: string): PdfProcessingContext {
    const clone = this.clone();
    clone.password = password;
    return clone;
  }

  withDefaultLogging(enabled: boolean): PdfProcessingContext {
    const clone = this.clone();
    clone.useDefaultLogging = enabled;
    return clone;
  }

  private clone(): PdfProcessingContext {
    return new PdfProcessingContext(
      this.workingPath,
      this.relativePath,
      this.recipient,
      this.targetDirectory,
      this.basename,
      {
        temporaryPaths: [...this.temporaryPaths],
        password: this.password,
        useDefaultLogging: this.useDefaultLogging,
      },
    );
  }
}
