// Counts failed attempts per key (an IP address, or IP + username) inside a sliding time window.
// After `max` failures in `windowMs`, the key is blocked until the oldest failure is older than the window.
class FailureLimiter {
  constructor({ windowMs, max, maxKeys = 10000, autoPrune = true }) {
    this.windowMs = windowMs;
    this.max = max;
    this.maxKeys = maxKeys;
    this.map = new Map();                              // key -> list of failure times (at most `max`)
    this.timer = null;
    if (autoPrune) {
      this.timer = setInterval(() => this.prune(), 60000);
      this.timer.unref();                              // never keeps the program alive
    }
  }

  _trim(list, now) {
    while (list.length && list[0] <= now - this.windowMs) list.shift();
  }

  // 0 if the key may try again, otherwise how many milliseconds it must wait
  blockedFor(key, now = Date.now()) {
    const list = this.map.get(key);
    if (!list) return 0;
    this._trim(list, now);
    if (list.length === 0) { this.map.delete(key); return 0; }
    return list.length >= this.max ? list[0] + this.windowMs - now : 0;
  }

  fail(key, now = Date.now()) {
    let list = this.map.get(key);
    if (!list) {
      if (this.map.size >= this.maxKeys) this.map.delete(this.map.keys().next().value);   // never grow without limit
      list = [];
      this.map.set(key, list);
    }
    this._trim(list, now);
    list.push(now);
    while (list.length > this.max) list.shift();
  }

  reset(key) {
    this.map.delete(key);
  }

  prune(now = Date.now()) {
    for (const [key, list] of this.map) {
      this._trim(list, now);
      if (list.length === 0) this.map.delete(key);
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}

module.exports = { FailureLimiter };
