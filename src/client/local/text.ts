/** Withhold incomplete tags and reasoning even when a tag crosses token boundaries. */
export function localText(raw: string, complete = true): string {
  let text = raw.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').replace(/<\/think>/g, '');
  if (!complete) text = text.replace(/<(?:\/?(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?)?$/g, '');
  return complete ? text.trim() : text.trimStart();
}
