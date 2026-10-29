import { m } from '#lib/paraglide/messages.js';
import type { SupportService } from '@householdr/domain';

/** Why leaving didn't go through, from the form action's error code. */
type LeaveProblem = 'invalid' | 'successor';

const problems: Record<LeaveProblem, () => string> = {
  invalid: m['leave.invalid'],
  successor: m['leave.successor-gone'],
};

/** Stands for the website in the support line, to put its link there: a character no message has. */
const mark = '';

/** A website's scheme, which its link's text leaves out. */
const scheme = /^https:\/\//;

/** What the leave page needs from its data. */
interface LeaveData {
  name: string;
  /** For the last head, who can become head, longest in the household first; null otherwise. */
  successors: { id: string; name: string }[] | null;
  support: SupportService | null;
}

/**
 * What the leave page needs besides its data (CODE-9): the two ways the household's history can
 * show the member, "Former member" to begin with (ADR-0018 §2, clarification); for the last head,
 * who becomes head, no one in particular to begin with, which gives it to whoever has been in the
 * household longest (ADR-0018 §2, clarification); the support line of the household's country as
 * one plain sentence around its website's link (ADR-0018 §8, clarification); and why leaving
 * didn't go through (CODE-13).
 */
export function useLeave(data: () => LeaveData) {
  const options = $derived([
    { value: 'former member' as const, id: 'shown-as-former', label: m['leave.as-former']() },
    {
      value: 'name' as const,
      id: 'shown-as-name',
      label: m['leave.as-name']({ name: data().name }),
    },
  ]);
  const successors = $derived.by(() => {
    const list = data().successors;
    const [longest] = list ?? [];
    if (!list || !longest) return null;
    return [
      {
        value: '',
        id: 'successor-rule',
        label: m['leave.successor-rule']({ name: longest.name }),
      },
      ...list.map(({ id, name }) => ({ value: id, id: `successor-${id}`, label: name })),
    ];
  });
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
    /** For the last head, the choice of who becomes head; null for anyone else. */
    get successors() {
      return successors;
    },
    /**
     * Whether leaving would close the household, the last head having no adult with an account to
     * pass it to (ADR-0018 §2, clarification).
     */
    get closes() {
      return data().successors?.length === 0;
    },
    get support() {
      return support;
    },
    /** A refusal in words. */
    problem: (code: LeaveProblem) => problems[code](),
  };
}
