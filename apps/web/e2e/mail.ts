import { expect } from '@playwright/test';

/**
 * Mailpit, the mail server the worker sends to during the end-to-end tests, on its default ports
 * (README). The tests read the e-mails from its API.
 */
export const mailServer = { smtp: { host: 'localhost', port: 1025 }, api: 'http://localhost:8025' };

/** Mailpit's search for the e-mails to `address`. */
const toAddress = (address: string) =>
  `${mailServer.api}/api/v1/search?${new URLSearchParams({ query: `to:"${address}"` }).toString()}`;

/** Fails unless Mailpit answers, saying how to start it. */
export async function expectMailServer() {
  const response = await fetch(`${mailServer.api}/api/v1/info`).catch(() => undefined);
  if (!response?.ok) {
    throw new Error(`Start Mailpit for the end-to-end tests, at ${mailServer.api} (README).`);
  }
}

/** Deletes every e-mail to `address`, such as those of an earlier run. */
export async function forgetMail(address: string) {
  const response = await fetch(toAddress(address), { method: 'DELETE' });
  expect(response.ok).toBe(true);
}

/** The text of the e-mail to `address` with `subject`, waiting for it to arrive. */
export async function mailTo(address: string, subject: string) {
  let text: string | undefined;
  await expect
    .poll(
      async () => {
        const { messages } = (await (await fetch(toAddress(address))).json()) as {
          messages: { ID: string; Subject: string }[];
        };
        const found = messages.find((message) => message.Subject === subject);
        if (!found) return undefined;
        const message = (await (
          await fetch(`${mailServer.api}/api/v1/message/${found.ID}`)
        ).json()) as { Text: string };
        text = message.Text;
        return text;
      },
      { message: `An e-mail to ${address}: ${subject}`, timeout: 20_000 },
    )
    .toBeDefined();
  return text ?? '';
}
