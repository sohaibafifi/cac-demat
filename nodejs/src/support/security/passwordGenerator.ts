import { randomBytes } from 'crypto';

export class PasswordGenerator {
  generate(bytes = 24): string {
    let password = '';

    do {
      password = randomBytes(bytes)
        .toString('base64')
        .replace(/[+/]/g, (char) => (char === '+' ? '-' : '_'))
        .replace(/=+$/g, '');
    } while (password !== '' && password.startsWith('-'));

    return password;
  }
}
