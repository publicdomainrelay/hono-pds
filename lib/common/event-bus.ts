export class EventBus<T> {
  #subs = new Set<(msg: T) => void>();

  subscribe(fn: (msg: T) => void): () => void {
    this.#subs.add(fn);
    return () => {
      this.#subs.delete(fn);
    };
  }

  publish(msg: T): void {
    for (const fn of this.#subs) {
      fn(msg);
    }
  }
}
