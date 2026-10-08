import { describe, expect, it } from 'vitest';
import { deviceOf } from './device';

describe('deviceOf (ADR-0010 §6)', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      'Chrome',
      'Windows',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
      'Chrome',
      'Android',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
      'Edge',
      'Windows',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
      'Samsung Internet',
      'Android',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/124.0.0.0',
      'Opera',
      'Windows',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0', 'Firefox', 'Linux'],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
      'Safari',
      'iOS',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
      'Chrome',
      'iOS',
    ],
    [
      'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/143.0 Mobile/15E148 Safari/605.1.15',
      'Firefox',
      'iPadOS',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
      'Safari',
      'macOS',
    ],
    [
      'Mozilla/5.0 (X11; CrOS x86_64 16328.65.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      'Chrome',
      'ChromeOS',
    ],
  ])('names the browser and system of %s', (userAgent, browser, system) => {
    expect(deviceOf(userAgent)).toEqual({ browser, system });
  });

  it('names nothing it doesn’t know', () => {
    expect(deviceOf('curl/8.9.1')).toEqual({ browser: null, system: null });
    expect(deviceOf('')).toEqual({ browser: null, system: null });
    expect(deviceOf(undefined)).toEqual({ browser: null, system: null });
  });
});
