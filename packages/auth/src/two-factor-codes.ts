import { timingSafeEqual } from 'node:crypto';
import { createOTP } from '@better-auth/utils/otp';
import { forgetCount, twoFactors } from '@householdr/db';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';
import * as v from 'valibot';
import type { SignInContext } from './sign-in';
import { useAppCode, type eitherCode } from './two-factor-sign-in';

/** How long each code from the app lasts, as the library sets them up: 30 seconds (RFC 6238). */
const period = 30_000;

/**
 * Whether `code` is one the app set up with `secret` shows at `now`, or in the period before or
 * after, as the library accepts at sign-in. The codes are the library's own (RFC 4226, 6238); only
 * the time is ours, from the clock (CODE-26). Every period is compared in full, in constant time.
 */
export async function isAppCode(secret: string, code: string, now: Temporal.Instant) {
  const step = Math.floor(now.epochMilliseconds / period);
  const otp = createOTP(secret);
  const typed = Buffer.from(code);
  let right = false;
  for (const drift of [-1, 0, 1]) {
    const shown = Buffer.from(await otp.hotp(step + drift));
    right = (shown.length === typed.length && timingSafeEqual(shown, typed)) || right;
  }
  return right;
}

/** The recovery codes not used yet, as the library keeps them: a JSON list, encrypted. */
const recoveryCodeList = v.array(v.string());

/**
 * Uses up one of the account's recovery codes, as the library does at sign-in: it is taken out of
 * the encrypted list, which is written back with the current key (ADR-0017 §7). Concurrent uses
 * queue on the account's row, so a code works once. False if it isn't one of them.
 */
async function useRecoveryCode(
  context: Pick<SignInContext, 'auth' | 'db'>,
  accountId: string,
  code: string,
) {
  const { secretConfig } = await context.auth.$context;
  return context.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ backupCodes: twoFactors.backupCodes })
      .from(twoFactors)
      .where(and(eq(twoFactors.userId, accountId), eq(twoFactors.verified, true)))
      .for('update');
    if (!row) return false;
    const decrypted = await symmetricDecrypt({ key: secretConfig, data: row.backupCodes });
    const codes = v.parse(recoveryCodeList, JSON.parse(decrypted));
    if (!codes.includes(code)) return false;
    const left = codes.filter((other) => other !== code);
    const backupCodes = await symmetricEncrypt({ key: secretConfig, data: JSON.stringify(left) });
    await tx
      .update(twoFactors)
      .set({ backupCodes, updatedAt: new Date() })
      .where(eq(twoFactors.userId, accountId));
    return true;
  });
}

/** Whether `code` is the account's app's now, checked against its encrypted secret. */
async function appCodeIsRight(
  context: Pick<SignInContext, 'auth' | 'db' | 'clock'>,
  accountId: string,
  code: string,
) {
  const [row] = await context.db
    .select({ secret: twoFactors.secret })
    .from(twoFactors)
    .where(and(eq(twoFactors.userId, accountId), eq(twoFactors.verified, true)));
  if (!row) return false;
  const { secretConfig } = await context.auth.$context;
  const secret = await symmetricDecrypt({ key: secretConfig, data: row.secret });
  return isAppCode(secret, code, context.clock.now());
}

/**
 * Checks a code of the account's own where no password came first, so the library's step after
 * one isn't there to check it, such as with a reset link (ADR-0010 §8). It is checked as at
 * sign-in, and works once in the same way: a code from the app is marked used, and a recovery code
 * is used up. Whether to check one at all, after wrong codes, is the caller's to count.
 */
export async function checkOwnCode(
  context: Pick<SignInContext, 'auth' | 'db' | 'clock' | 'counterKey'>,
  accountId: string,
  typed: v.InferOutput<typeof eitherCode>,
): Promise<boolean> {
  if ('recoveryCode' in typed) return useRecoveryCode(context, accountId, typed.recoveryCode);
  const used = await useAppCode(context, accountId, typed.code);
  if (!used) return false;
  const right = await appCodeIsRight(context, accountId, typed.code);
  if (!right) await forgetCount(context.db, used);
  return right;
}
