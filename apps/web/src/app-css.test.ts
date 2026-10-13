import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The design tokens meet the contrast of ADR-0011 §4 in every theme, checked on the tokens
// themselves (§8): 4.5:1 for text, 3:1 for the borders of controls and the focus ring.

const css = readFileSync(new URL('app.css', import.meta.url), 'utf8');

/** The custom properties set in the first `:root` rule after `from` in the stylesheet. */
function tokensAfter(from: string): Record<string, string> {
  const start = css.indexOf(from);
  if (start < 0) throw new Error(`No ${from} in app.css.`);
  const body = /:root\s*{([^}]*)}/.exec(css.slice(start))?.[1] ?? '';
  return Object.fromEntries(
    Array.from(body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g), ([, name = '', value = '']) => [
      name,
      value.trim(),
    ]),
  );
}

const light = tokensAfter(':root');
const dark = { ...light, ...tokensAfter('@media (prefers-color-scheme: dark) {') };
const more = tokensAfter('@media (prefers-contrast: more) {');
const themes = {
  light,
  dark,
  'light, more contrast': { ...light, ...more },
  'dark, more contrast': { ...dark, ...more },
};

/** A token's colour as an OKLCH triple, following `var()` references within the theme. */
function oklch(theme: Record<string, string>, token: string): [number, number, number] {
  const value = theme[token];
  if (!value) throw new Error(`No ${token}.`);
  const reference = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  if (reference) return oklch(theme, reference);
  const parts = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value);
  if (!parts) throw new Error(`${token} is not an opaque oklch() colour: ${value}`);
  return [Number(parts[1]), Number(parts[2]), Number(parts[3])];
}

/** An OKLCH colour in linear sRGB, clipped to its gamut. */
function linear([l, c, h]: [number, number, number]): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const lms = [
    l + 0.3963377774 * a + 0.2158037573 * b,
    l - 0.1055613458 * a - 0.0638541728 * b,
    l - 0.0894841775 * a - 1.291485548 * b,
  ].map((x) => x ** 3) as [number, number, number];
  const [x, y, z] = lms;
  const rgb = [
    4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z,
    -1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z,
    -0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z,
  ].map((channel) => Math.min(Math.max(channel, 0), 1));
  return rgb as [number, number, number];
}

/** WCAG relative luminance of a colour in linear sRGB. */
const luminance = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const encoded = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const decoded = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** `front` at `alpha` over `back`, mixed as browsers do, in encoded sRGB. */
const over = (front: [number, number, number], back: [number, number, number], alpha: number) =>
  front.map((v, i) => decoded(alpha * encoded(v) + (1 - alpha) * encoded(back[i] ?? 0))) as [
    number,
    number,
    number,
  ];

/** The contrast of `front` on `back`, or on `front` at `tint` over `back` when given. */
function contrast(theme: Record<string, string>, front: string, back: string, tint?: number) {
  const fore = linear(oklch(theme, front));
  const behind = linear(oklch(theme, back));
  const [lighter, darker] = [
    luminance(fore),
    luminance(tint === undefined ? behind : over(fore, behind, tint)),
  ].sort((p, q) => q - p) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

const text: [string, string][] = [
  ['--foreground', '--background'],
  ['--card-foreground', '--card'],
  ['--popover-foreground', '--popover'],
  ['--primary-foreground', '--primary'],
  ['--secondary-foreground', '--secondary'],
  ['--muted-foreground', '--background'],
  ['--muted-foreground', '--muted'],
  ['--accent-foreground', '--accent'],
  ['--destructive', '--background'],
];
/**
 * Text on a tint of its own colour, as the destructive button is, at rest and hovered: the
 * opacities of its classes in components/ui/button, per theme.
 */
const tinted: Record<'light' | 'dark', [string, string, number][]> = {
  light: [
    ['--destructive', '--background', 0.1],
    ['--destructive', '--background', 0.2],
  ],
  dark: [
    ['--destructive', '--background', 0.2],
    ['--destructive', '--background', 0.25],
  ],
};
const controls: [string, string][] = [
  ['--input', '--background'],
  ['--ring', '--background'],
];

describe('the design tokens (ADR-0011 §4)', () => {
  for (const [name, theme] of Object.entries(themes)) {
    it(`give text 4.5:1 in ${name}`, () => {
      for (const [front, back] of text) {
        expect(contrast(theme, front, back), `${front} on ${back}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const [front, back, tint] of tinted[name.startsWith('dark') ? 'dark' : 'light']) {
        expect(
          contrast(theme, front, back, tint),
          `${front} on ${String(tint)} of it`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`give the borders of controls and the focus ring 3:1 in ${name}`, () => {
      for (const [front, back] of controls) {
        expect(contrast(theme, front, back), `${front} on ${back}`).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it('reads each theme’s own tokens', () => {
    expect(dark['--background']).not.toBe(light['--background']);
    expect(more['--input']).toBe('var(--foreground)');
  });

  it('measures contrast the way WCAG does', () => {
    const blackOnWhite = { '--a': 'oklch(0 0 0)', '--b': 'oklch(1 0 0)' };
    expect(contrast(blackOnWhite, '--a', '--b')).toBeCloseTo(21, 1);
    expect(contrast(blackOnWhite, '--b', '--b')).toBeCloseTo(1, 5);
  });
});
