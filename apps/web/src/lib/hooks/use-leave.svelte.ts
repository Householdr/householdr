import { m } from '#lib/paraglide/messages.js';
import type { SupportService } from '@householdr/domain';

/** Why leaving didn't go through, from the form action's error code. */
type LeaveProblem = 'invalid' | 'last-head';

const problems: Record<LeaveProblem, () => string> = {
  invalid: m['leave.invalid'],
  'last-head': m['leave.last-head'],
};

/** Stands for the website in the support line, to put its link there: a character no message has. */
const mark = '\uE000';

/** A website's scheme, which its link's text leaves out. */
const scheme = /^https:\/\//;

/**
 * What the leave page needs besides its data (CODE-9): the two ways the household's history can
 * show the member, "Former member" to begin with (ADR-0018 §2, clarification); the support line
 * of the household's country as one plain sentence around its website's link (ADR-0018 §8,
 * clarification); and why leaving didn't go through (CODE-13).
 */
export function useLeave(data: () => { name: string; support: SupportService | null }) {
  const options = $derived([
    { value: 'former member' as const, id: 'shown-as-former', label: m['leave.as-former']() },
    {
      value: 'name' as const,
      id: 'shown-as-name',
      label: m['leave.as-name']({ name: data().name }),
    },
  ]);
  const support = $derived.by(() => {
    const service = data().support;
    if (!service) return null;
    const sentence = m['leave.support']({
      service: service.name,
      phone: service.phone,
      website: mark,
    });
    const [before = '', after = ''] = sentence.split(mark);
    return { before, after, href: service.website, site: service.website.replace(scheme, '') };
  });

  return {
    get options() {
      return options;
    },
    get support() {
      return support;
    },
    /** A refusal in words. */
    problem: (code: LeaveProblem) => problems[code](),
  };
}
