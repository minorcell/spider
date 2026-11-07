/** Machine messages must never become words above the spider. */
export function speechText(text: string): string {
  const body = text.replace(/^\s*答[：:]\s*/, '');
  return /[{}[\]`]|<\/?(?:tool|function)|<\||工具执行结果\s*[:：]|"(?:name|arguments|tool_calls|observation|ok)"\s*:/i.test(
    body,
  )
    ? ''
    : body;
}
