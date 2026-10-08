import { encode } from 'uqr';

/** A QR code to draw as one SVG path: a 1 × 1 square for each dark module, on a `size` grid. */
export interface QrCode {
  size: number;
  path: string;
}

/**
 * `text` as a QR code, such as the `otpauth://` URI that sets up an authenticator app, with the
 * quiet zone of 4 modules scanners need. The page draws it from plain values, never from markup
 * it would have to trust (SEC-4).
 */
export function qrCode(text: string): QrCode {
  const { size, data } = encode(text, { ecc: 'M', border: 4 });
  const path = data
    .flatMap((row, y) =>
      row.flatMap((dark, x) => (dark ? [`M${String(x)} ${String(y)}h1v1h-1z`] : [])),
    )
    .join('');
  return { size, path };
}
