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
    [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name = '', value = '']) => [
      name,
      value.trim(),
    ]),
  );
}

const light = tokensAfter(':root');
const dark = { ...light, ...tokensAfter('(prefers-color-scheme: dark)') };
const more = tokensAfter('(prefers-contrast: more)');
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

/** WCAG relative luminance of an OKLCH colour, through linear sRGB. */
function luminance([l, c, h]: [number, number, number]) {
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
  return 0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0);
}

function contrast(theme: Record<string, string>, front: string, back: string) {
  const [lighter, darker] = [luminance(oklch(theme, front)), luminance(oklch(theme, back))].sort(
    (p, q) => q - p,
  ) as [number, number];
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
    });

    it(`give the borders of controls and the focus ring 3:1 in ${name}`, () => {
      for (const [front, back] of controls) {
        expect(contrast(theme, front, back), `${front} on ${back}`).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it('measures contrast the way WCAG does', () => {
    const blackOnWhite = { '--a': 'oklch(0 0 0)', '--b': 'oklch(1 0 0)' };
    expect(contrast(blackOnWhite, '--a', '--b')).toBeCloseTo(21, 1);
    expect(contrast(blackOnWhite, '--b', '--b')).toBeCloseTo(1, 5);
  });
});
