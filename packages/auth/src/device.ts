/** What the security page shows of the device a session was started on, by name. */
export interface DeviceNames {
  browser: string | null;
  system: string | null;
}

// The first match wins: Edge and Opera also say Chrome, Chrome also says Safari, and Android also
// says Linux.
const browsers: [string, RegExp][] = [
  ['Edge', /\bEdg(?:e|A|iOS)?\//],
  ['Samsung Internet', /\bSamsungBrowser\//],
  ['Opera', /\b(?:OPR|Opera)\//],
  ['Firefox', /\b(?:Firefox|FxiOS)\//],
  ['Chrome', /\b(?:Chrome|CriOS)\//],
  ['Safari', /\bVersion\/[\d.]+.*\bSafari\//],
];
const systems: [string, RegExp][] = [
  ['iPadOS', /\biPad\b/],
  ['iOS', /\b(?:iPhone|iPod)\b/],
  ['Android', /\bAndroid\b/],
  ['ChromeOS', /\bCrOS\b/],
  ['Windows', /\bWindows\b/],
  ['macOS', /\bMac OS X\b/],
  ['Linux', /\bLinux\b/],
];

/**
 * The browser and operating system a user agent names, and nothing else of it: the security page
 * needs no versions (ADR-0010 §6, ADR-0012 §2, clarification). Either is null when unknown.
 */
export function deviceOf(userAgent: string | null | undefined): DeviceNames {
  const named = (list: [string, RegExp][]) =>
    list.find(([, pattern]) => pattern.test(userAgent ?? ''))?.[0] ?? null;
  return { browser: named(browsers), system: named(systems) };
}
