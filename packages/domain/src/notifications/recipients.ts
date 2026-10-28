import type { Role } from '../permissions/household';

/**
 * What a notification says happened, one for each row of the catalogue the app sends so far
 * (ADR-0014 §2): a week's draft is ready for the heads to review, or a week's plan is published.
 */
export type NotificationKind = 'plan.drafted' | 'plan.published';

/** A member of the household, as notifications see them. */
export interface Notifiable {
  id: string;
  role: Role;
  hasAccount: boolean;
}

/** What happened, with what decides whom it is for. */
export type NotificationEvent =
  | { kind: 'plan.drafted' }
  | {
      kind: 'plan.published';
      /** The members with an occurrence in the plan. */
      assigned: ReadonlySet<string>;
    };

/**
 * The members told about `event` (ADR-0014 §2, ADR-0006 §5, clarifications): heads for a draft
 * ready for review, and each member with an occurrence in a published plan. Only members with an
 * account, who can read it, and never `actor`, whose own action it was.
 */
export function recipients(
  event: NotificationEvent,
  members: readonly Notifiable[],
  actor: string | undefined,
): string[] {
  const isFor = (member: Notifiable) => {
    switch (event.kind) {
      case 'plan.drafted':
        return member.role === 'head';
      case 'plan.published':
        return event.assigned.has(member.id);
    }
  };
  return members
    .filter((member) => member.hasAccount && member.id !== actor && isFor(member))
    .map((member) => member.id);
}
