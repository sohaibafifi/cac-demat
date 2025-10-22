export class NameSanitizer {
  /**
   * Replace any non letter/number/._- characters with underscores. Fallback when result is empty.
   */
  static sanitize(name: string, fallback: string): string {
    const trimmed = name.trim();
    if (trimmed === '') {
      return fallback;
    }

    const sanitised = trimmed.replace(/[^\p{L}\p{N}._-]+/gu, '_');
    return sanitised === '' ? fallback : sanitised;
  }
}
