// Fixed-capacity ring buffer. Order flow work is all "last N events", and the
// naive Array#shift() version is what turns a tick handler into a GC problem.
export class Ring {
  constructor(capacity) {
    this.capacity = capacity;
    this.buf = new Array(capacity);
    this.head = 0;
    this.size = 0;
  }

  push(item) {
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
    return item;
  }

  /** index 0 = oldest retained item */
  at(i) {
    if (i < 0 || i >= this.size) return undefined;
    const start = (this.head - this.size + this.capacity) % this.capacity;
    return this.buf[(start + i) % this.capacity];
  }

  last(n = 1) {
    return this.at(this.size - n);
  }

  toArray() {
    const out = new Array(this.size);
    for (let i = 0; i < this.size; i++) out[i] = this.at(i);
    return out;
  }

  /** Newest-first iteration, stops as soon as fn returns false. */
  scanBack(fn) {
    for (let i = this.size - 1; i >= 0; i--) {
      if (fn(this.at(i)) === false) return;
    }
  }
}
