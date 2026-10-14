import { describe, expect, it } from 'vitest';
import { isKnownPushService } from './push-services';

// Subscriptions only on the known push services (ADR-0017 §6, clarification). Invented endpoints.

describe('isKnownPushService (ADR-0017 §6)', () => {
  it('takes the endpoints of Apple’s, Google’s, Mozilla’s and Microsoft’s push services', () => {
    for (const endpoint of [
      'https://web.push.apple.com/QGuQyavXutnMH8ZvB1Y0',
      'https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91b',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk',
      'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB',
    ]) {
      expect(isKnownPushService(endpoint), endpoint).toBe(true);
    }
  });

  it('refuses any other host, and any but plain https', () => {
    for (const endpoint of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com:8443/fcm/send/abc',
      'https://user:secret@fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com.example.org/fcm/send/abc',
      'https://notify.windows.com.example.org/w/',
      'https://evilnotify.windows.com/w/',
      'https://push.example.org/abc',
      'https://10.0.0.1/push',
      'not a url',
      '',
    ]) {
      expect(isKnownPushService(endpoint), endpoint).toBe(false);
    }
  });
});
