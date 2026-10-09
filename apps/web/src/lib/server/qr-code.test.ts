import { describe, expect, it } from 'vitest';
import { qrCode } from './qr-code';

describe('qrCode', () => {
  it('draws the modules inside a quiet zone of 4, starting with a finder pattern', () => {
    const { size, path } = qrCode('otpauth://totp/Householdr:robin%40example.org?secret=JBSWY3DP');
    // A version 1 to 40 code is 21 to 177 modules wide; the quiet zone adds 4 on each side.
    expect((size - 8 - 21) % 4).toBe(0);
    expect(size).toBeGreaterThanOrEqual(29);
    const squares = path.match(/M\d+ \d+h1v1h-1z/g) ?? [];
    expect(squares.join('')).toBe(path);
    // Nothing in the quiet zone; the finder pattern's corner right inside it.
    for (const square of squares) {
      const [x = 0, y = 0] = (square.match(/\d+/g) ?? []).map(Number);
      expect([x, y].every((at) => at >= 4 && at < size - 4)).toBe(true);
    }
    expect(squares[0]).toBe('M4 4h1v1h-1z');
  });

  it('is the same for the same text', () => {
    expect(qrCode('otpauth://totp/a')).toEqual(qrCode('otpauth://totp/a'));
  });
});
