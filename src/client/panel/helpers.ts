export function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function thoughtOf(input: unknown): string {
  if (!input || typeof input !== 'object' || !('description' in input)) return '';
  const description = input.description;
  return typeof description === 'string' ? description : '';
}

export function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function explain(message: string): string {
  if (message === 'Failed to fetch' || message.includes('Failed to fetch')) {
    return '请求没有发出去。这个地址可能不允许浏览器跨域。';
  }
  return message;
}
