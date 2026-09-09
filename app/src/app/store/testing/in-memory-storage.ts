import { StorageBackend } from '../storage';

/**
 * The documents, in a Map. What {@link Persistence} is, minus the server
 * behind it.
 *
 * Every spec that reaches a store needs one, because the stores read at
 * construction: a store built without a backend to read from would look
 * exactly like a fresh install. It was declared eleven times, identically,
 * once per spec that needed it — and the eleventh copy is the one that would
 * have been left behind the day {@link StorageBackend} grew a method.
 *
 * `documents` is public because that is what the specs assert on: the point of
 * most of them is that the document on the other side of the write is the one
 * the store said it wrote.
 */
export class InMemoryStorage implements StorageBackend {
  readonly documents = new Map<string, unknown>();

  read<T>(key: string): T | null {
    return (this.documents.get(key) as T) ?? null;
  }
  write(key: string, value: unknown): void {
    this.documents.set(key, value);
  }
  remove(key: string): void {
    this.documents.delete(key);
  }
  keys(prefix: string): string[] {
    return [...this.documents.keys()].filter((key) => key.startsWith(prefix));
  }
}
