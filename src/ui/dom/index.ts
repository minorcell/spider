/** Create one element. `class` and `hidden` are applied as properties; other keys become attributes. */
export function h<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'hidden') node.hidden = value === true;
    else node.setAttribute(key, String(value));
  }
  for (const child of children) node.append(child);
  return node;
}
