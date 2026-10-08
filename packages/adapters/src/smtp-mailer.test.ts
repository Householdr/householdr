import { createServer, type AddressInfo, type Socket } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { smtpMailer, type SmtpSettings } from './smtp-mailer';

/** What a local SMTP server, without TLS or accounts, received. */
interface Received {
  from: string;
  to: string[];
  data: string;
}

let received: Received[] = [];
let commands: string[] = [];

/** Just enough of SMTP (RFC 5321) to accept one message per transaction. */
function converse(socket: Socket) {
  let buffer = '';
  let current: Received = { from: '', to: [], data: '' };
  let inData = false;
  socket.write('220 test.example.org ESMTP\r\n');
  socket.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    for (;;) {
      if (inData) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end === -1) return;
        current.data = buffer.slice(0, end);
        buffer = buffer.slice(end + 5);
        inData = false;
        received.push(current);
        current = { from: '', to: [], data: '' };
        socket.write('250 Queued\r\n');
        continue;
      }
      const end = buffer.indexOf('\r\n');
      if (end === -1) return;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      commands.push(line.split(/[ :]/)[0]?.toUpperCase() ?? '');
      if (/^EHLO /i.test(line)) socket.write('250-test.example.org\r\n250 8BITMIME\r\n');
      else if (/^MAIL FROM:/i.test(line)) {
        current.from = line.replace(/^MAIL FROM:<([^>]*)>.*$/i, '$1');
        socket.write('250 OK\r\n');
      } else if (/^RCPT TO:/i.test(line)) {
        current.to.push(line.replace(/^RCPT TO:<([^>]*)>.*$/i, '$1'));
        socket.write('250 OK\r\n');
      } else if (/^DATA$/i.test(line)) {
        inData = true;
        socket.write('354 Go ahead\r\n');
      } else if (/^(RSET|NOOP)$/i.test(line)) socket.write('250 OK\r\n');
      else if (/^QUIT$/i.test(line)) socket.end('221 Bye\r\n');
      else socket.write('502 Not implemented\r\n');
    }
  });
}

const sockets = new Set<Socket>();
const server = createServer((socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  converse(socket);
});
let port = 0;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

beforeEach(() => {
  received = [];
  commands = [];
});

afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
});

function settings(changes: Partial<SmtpSettings> = {}): SmtpSettings {
  return {
    host: '127.0.0.1',
    port,
    from: 'Householdr <householdr@example.org>',
    requireTls: false,
    ...changes,
  };
}

const mail = {
  to: 'member@example.org',
  subject: 'Your plan for this week',
  text: 'Your plan is ready.',
  html: '<p>Your plan is ready.</p>',
};

describe('the SMTP mailer (ADR-0014 §7)', () => {
  it('sends from the configured sender to the recipient', async () => {
    await smtpMailer(settings()).send(mail);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      from: 'householdr@example.org',
      to: ['member@example.org'],
    });
  });

  it('sends a plain-text and an HTML part (ADR-0014 §6)', async () => {
    await smtpMailer(settings()).send(mail);
    const data = received[0]?.data ?? '';
    expect(data).toMatch(/^From: Householdr <householdr@example\.org>$/m);
    expect(data).toMatch(/^To: member@example\.org$/m);
    expect(data).toMatch(/^Subject: Your plan for this week$/m);
    expect(data).toMatch(/^Content-Type: multipart\/alternative;/m);
    expect(data).toMatch(/^Content-Type: text\/plain; charset=utf-8$/m);
    expect(data).toMatch(/^Content-Type: text\/html; charset=utf-8$/m);
    expect(data).toContain('Your plan is ready.');
    expect(data).toContain('<p>Your plan is ready.</p>');
  });

  it('adds nothing about the software that sent it', async () => {
    await smtpMailer(settings()).send(mail);
    expect(received[0]?.data).not.toMatch(/^X-Mailer:/im);
  });

  it('encodes a subject in another language', async () => {
    await smtpMailer(settings()).send({ ...mail, subject: 'Votre planning a été publié' });
    expect(received[0]?.data).toMatch(/^Subject: =\?UTF-8\?Q\?.*\?=$/m);
  });

  it('refuses to send without TLS when TLS is required', async () => {
    await expect(smtpMailer(settings({ requireTls: true })).send(mail)).rejects.toThrow();
    expect(commands).not.toContain('MAIL');
    expect(received).toEqual([]);
  });
});
