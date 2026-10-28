type Environment = Record<string, string | undefined>;

/** How long a served `security.txt` says it holds: under a year, as RFC 9116 §2.5.5 advises. */
const holds = { hours: 180 * 24 };

/**
 * The instance's `security.txt` (ADR-0017 §11, RFC 9116): its security contact and, if it has one,
 * the policy that says how to report, what it promises and that good-faith research won't be
 * pursued. Both are the operator's, from `SECURITY_CONTACT` and `SECURITY_POLICY_URL`
 * (.env.example), as whoever runs an instance answers for it (ADR-0021 §6). None without a contact.
 */
export function securityTxt(env: Environment, now: Temporal.Instant): string | null {
  const contact = env.SECURITY_CONTACT;
  if (!contact) return null;
  const lines = [
    `Contact: ${contact}`,
    `Expires: ${now.add(holds).round('second').toString()}`,
    ...(env.SECURITY_POLICY_URL ? [`Policy: ${env.SECURITY_POLICY_URL}`] : []),
    'Preferred-Languages: en, nl',
    ...(env.ORIGIN ? [`Canonical: ${env.ORIGIN}/.well-known/security.txt`] : []),
  ];
  return `${lines.join('\n')}\n`;
}
