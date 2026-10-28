import type { Mail } from '@householdr/application';

/** A part of an e-mail: a paragraph, a paragraph that is a link, or a list. */
export type Block = string | { text: string; link: string } | { list: string[] };

/**
 * An e-mail as plain text and as accessible HTML (ADR-0014 §6), with every inserted value escaped
 * the same way (ADR-0017 §3): no images, scripts, styles or tracking.
 */
export function mail(to: string, subject: string, blocks: Block[], locale: string): Mail {
  return {
    to,
    subject,
    text: blocks.map(asText).join('\n\n'),
    html: [
      '<!doctype html>',
      `<html lang="${escape(locale)}">`,
      `<head><meta charset="utf-8"><title>${escape(subject)}</title></head>`,
      '<body>',
      ...blocks.map(asHtml),
      '</body>',
      '</html>',
    ].join('\n'),
  };
}

function asText(block: Block) {
  if (typeof block === 'string') return block;
  if ('list' in block) return block.list.map((item) => `- ${item}`).join('\n');
  return `${block.text}:\n${block.link}`;
}

function asHtml(block: Block) {
  if (typeof block === 'string') return `<p>${escape(block)}</p>`;
  if ('list' in block) {
    return `<ul>${block.list.map((item) => `<li>${escape(item)}</li>`).join('')}</ul>`;
  }
  return `<p><a href="${escape(block.link)}">${escape(block.text)}</a></p>`;
}

const entities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Text as it may stand in HTML, in an element or an attribute. */
function escape(text: string) {
  return text.replace(/[&<>"']/g, (character) => entities[character] ?? character);
}
