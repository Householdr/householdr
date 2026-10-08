import type { SubmitFunction } from '$app/forms';
import { afterNavigate } from '$app/navigation';
import type { Attachment } from 'svelte/attachments';

/**
 * Takes the focus to the next question of the comparison game once an answer is saved or a pair
 * skipped, so the keyboard and screen readers carry on from there (UI-7, ADR-0011 §6). Without
 * JavaScript, the page does it with `autofocus`.
 */
export function useComparisons() {
  let question: HTMLElement | null = null;
  const focusQuestion = () => {
    question?.focus();
  };

  // A skip, and an answer given after skips, land on the page's own address without them.
  afterNavigate(({ type }) => {
    if (type === 'form') focusQuestion();
  });

  return {
    /** Marks the question that takes the focus. */
    question: ((element) => {
      question = element;
      return () => {
        question = null;
      };
    }) satisfies Attachment<HTMLElement>,
    /** Sends an answer, then moves on to the next question, or to why it wasn't saved. */
    answer: (() =>
      async ({ result, update }) => {
        await update();
        if (result.type === 'success') focusQuestion();
      }) satisfies SubmitFunction,
  };
}
