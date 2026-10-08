import type { Config } from '@sveltejs/kit/vite';

type CspDirectives = NonNullable<NonNullable<Config['csp']>['directives']>;

/**
 * The Content Security Policy of ADR-0017 §4. SvelteKit adds a nonce per request to `script-src`;
 * inline scripts never run, and no inline style is allowed until Svelte needs one.
 */
export const contentSecurityPolicy: CspDirectives = {
  'default-src': ['self'],
  'script-src': ['self'],
  'object-src': ['none'],
  'base-uri': ['none'],
  'frame-ancestors': ['none'],
  'form-action': ['self'],
  // Data and blob URLs for the QR codes of invitations and device sign-in (ADR-0010 §4, §5).
  'img-src': ['self', 'data:', 'blob:'],
  'connect-src': ['self'],
};

/**
 * Powerful browser features the app doesn't use, switched off. The camera stays on for this site
 * (QR scanning), and passkeys and Web Share keep their same-site default (ADR-0017 §4,
 * clarification).
 */
const unusedFeatures = [
  'accelerometer',
  'ambient-light-sensor',
  'autoplay',
  'bluetooth',
  'browsing-topics',
  'display-capture',
  'encrypted-media',
  'fullscreen',
  'gamepad',
  'geolocation',
  'gyroscope',
  'hid',
  'idle-detection',
  'local-fonts',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'picture-in-picture',
  'screen-wake-lock',
  'serial',
  'usb',
  'xr-spatial-tracking',
];

/** The other response headers of ADR-0017 §4, on every response. */
export const securityHeaders: Record<string, string> = {
  'strict-transport-security': 'max-age=63072000',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': ['camera=(self)', ...unusedFeatures.map((name) => `${name}=()`)].join(', '),
};
