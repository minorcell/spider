import type { InlineCall } from '@/src/client/agent/inline';

type State = 'text' | 'name' | 'direct' | 'ticks' | 'fence' | 'json' | 'marker';

/** Scans each character once; only ambiguous syntax, never ordinary prose, is retained. */
export class InlineStream {
  readonly calls: InlineCall[] = [];
  private state: State = 'text';
  private candidate: string[] = [];
  private prefix: string[] = [];
  private probe = '';
  private previous = '';
  private stage = 0;
  private paren = false;
  private closeParen = false;
  private ticks = 0;
  private depth = 0;
  private quoted = false;
  private escaped = false;
  private whitespace: string[] = [];
  private output: string[] = [];

  constructor(
    private readonly names: readonly string[],
    private readonly classify: (text: string) => InlineCall[],
  ) {}

  push(text: string): string {
    for (const char of text) {
      this.scan(char);
      this.previous = char;
    }
    return this.drain();
  }

  finish(): string {
    // An unfinished outer object/fence can still contain a complete nested call.
    if (this.candidate.length || this.prefix.length) this.settle();
    if (this.calls.length === 0) this.output.push(this.whitespace.join(''));
    this.whitespace = [];
    return this.drain();
  }

  private scan(char: string): void {
    switch (this.state) {
      case 'json':
        this.candidate.push(char);
        if (this.quoted) {
          if (this.escaped) this.escaped = false;
          else if (char === '\\') this.escaped = true;
          else if (char === '"') this.quoted = false;
        } else if (char === '"') this.quoted = true;
        else if (char === '{' || char === '[') this.depth += 1;
        else if (char === '}' || char === ']') {
          this.depth -= 1;
          if (this.depth === 0) this.settle();
        }
        return;
      case 'fence':
        this.candidate.push(char);
        this.ticks = char === '`' ? this.ticks + 1 : 0;
        if (this.ticks === 3) this.settle();
        return;
      case 'ticks':
        if (char === '`') {
          this.candidate.push(char);
          this.ticks += 1;
          if (this.ticks === 3) {
            this.state = 'fence';
            this.ticks = 0;
          }
          return;
        }
        this.release();
        break;
      case 'marker':
        if (this.candidate.length === 1 && char !== '|' && char !== '｜') {
          this.release();
          break;
        }
        this.candidate.push(char);
        if (char === '>') {
          if (this.previous === '|' || this.previous === '｜') {
            this.prefix.push(this.candidate.join(''));
            this.candidate = [];
            this.state = 'text';
          } else this.release();
        }
        return;
      case 'name': {
        const next = this.probe + char;
        if (this.names.some((name) => name.startsWith(next))) {
          this.probe = next;
          this.candidate.push(char);
          return;
        }
        if (this.names.includes(this.probe) && !/[A-Za-z0-9_]/.test(char)) {
          this.state = 'direct';
          this.stage = 0;
          this.scan(char);
          return;
        }
        this.release();
        break;
      }
      case 'direct':
        if (/\s/.test(char)) {
          this.candidate.push(char);
          return;
        }
        if ((char === ':' && this.stage === 0) || (char === '(' && this.stage < 2)) {
          this.candidate.push(char);
          this.stage = char === ':' ? 1 : 2;
          this.paren = char === '(';
          return;
        }
        if (char !== '{' && char !== '`') this.release();
        break;
      case 'text':
        break;
    }

    if (this.closeParen) {
      if (/\s/.test(char)) {
        this.emit(char);
        return;
      }
      this.closeParen = false;
      if (char === ')') return;
    }

    if (char === '{' || char === '[') {
      this.state = 'json';
      this.depth = 1;
      this.quoted = false;
      this.escaped = false;
    } else if (char === '`') {
      this.state = 'ticks';
      this.ticks = 1;
    } else if (char === '<') this.state = 'marker';
    else if (
      !/[A-Za-z0-9_]/.test(this.previous) &&
      this.names.some((name) => name.startsWith(char))
    ) {
      this.state = 'name';
      this.probe = char;
    } else {
      if (this.prefix.length && /\s/.test(char)) {
        this.prefix.push(char);
        return;
      }
      this.emit(this.prefix.join('') + char);
      this.prefix = [];
      return;
    }
    this.candidate.push(char);
  }

  private settle(): void {
    const text = this.prefix.join('') + this.candidate.join('');
    const calls = this.classify(text);
    for (const call of calls) this.calls.push(call);
    if (calls.length === 0) this.emit(text);
    this.closeParen = calls.length > 0 && this.paren;
    this.reset();
  }

  private release(): void {
    this.emit(this.prefix.join('') + this.candidate.join(''));
    this.reset();
  }

  private reset(): void {
    this.candidate = [];
    this.prefix = [];
    this.paren = false;
    this.state = 'text';
  }

  private emit(text: string): void {
    // Retain trailing space so a tool-only suffix doesn't leave dangling whitespace.
    for (const char of text) {
      if (/\s/.test(char)) this.whitespace.push(char);
      else {
        this.output.push(this.whitespace.join(''), char);
        this.whitespace = [];
      }
    }
  }

  private drain(): string {
    const text = this.output.join('');
    this.output = [];
    return text;
  }
}
