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

  /**
   * Sanitize a file name while keeping spaces/dashes for readability.
   * Invalid filesystem characters are replaced with underscores and
   * whitespace is normalised.
   */
  static sanitizeForFileName(name: string, fallback: string): string {
    const trimmed = name.trim();
    if (trimmed === '') {
      return fallback;
    }

    const withoutInvalidChars = trimmed
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();

    return withoutInvalidChars === '' ? fallback : withoutInvalidChars;
  }
}
