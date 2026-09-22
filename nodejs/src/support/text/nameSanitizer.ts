export class NameSanitizer {
  /**
   * Replace any non letter/number/._- characters with underscores. Fallback when result is empty.
   */
  static sanitize(name: string, fallback: string): string {
    const trimmed = name.trim();
    const sanitised = trimmed.replace(/[^\p{L}\p{N}._-]+/gu, '_');
    return this.validate(sanitised === '' ? fallback : sanitised);
  }

  /**
   * Sanitize a file name while keeping spaces/dashes for readability.
   * Invalid filesystem characters are replaced with underscores and
   * whitespace is normalised.
   */
  static sanitizeForFileName(name: string, fallback: string): string {
    const trimmed = name.trim();
    const withoutInvalidChars = trimmed
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();

    return this.validate(withoutInvalidChars === '' ? fallback : withoutInvalidChars);
  }

  private static validate(value: string): string {
    if (/^\.+$/.test(value)) {
      throw new Error('Nom invalide : un nom de CAC ou de destinataire ne peut pas être composé uniquement de points.');
    }
    return value;
  }
}
