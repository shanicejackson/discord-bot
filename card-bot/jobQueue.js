class JobQueue {
  constructor(concurrency = 3) {
    this.concurrency = Math.max(1, parseInt(concurrency, 10) || 1);
    this.running = 0;
    this.queue = [];
  }

  // Enqueue a task function that returns a Promise. Returns a Promise
  // that resolves/rejects with the task's result.
  enqueue(task, opts = {}) {
    return new Promise((resolve, reject) => {
      const item = { task, resolve, reject, opts };
      this.queue.push(item);
      this._tryToStartNext();
    });
  }

  _tryToStartNext() {
    if (this.running >= this.concurrency) return;
    const next = this.queue.shift();
    if (!next) return;
    this.running += 1;
    const { task, resolve, reject, opts } = next;

    let finished = false;
    // Optional timeout per-job
    const timeoutMs = opts && opts.timeout ? Number(opts.timeout) : 0;
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        try { reject(new Error('job-timeout')); } catch (e) {}
        this.running -= 1;
        this._tryToStartNext();
      }, timeoutMs);
    }

    Promise.resolve()
      .then(() => task())
      .then((res) => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        reject(err);
      })
      .finally(() => {
        // allow next job to start
        this.running -= 1;
        this._tryToStartNext();
      });
  }
}

module.exports = JobQueue;
class JobQueue {
  constructor(concurrency = 3) {
    this.concurrency = Math.max(1, parseInt(concurrency, 10) || 1);
    this.running = 0;
    this.queue = [];
  }

  // Enqueue a task function that returns a Promise. Returns a Promise
  // that resolves/rejects with the task's result.
  enqueue(task, opts = {}) {
    return new Promise((resolve, reject) => {
      const item = { task, resolve, reject, opts };
      this.queue.push(item);
      this._tryToStartNext();
    });
  }

  _tryToStartNext() {
    if (this.running >= this.concurrency) return;
    const next = this.queue.shift();
    if (!next) return;
    this.running += 1;
    const { task, resolve, reject, opts } = next;

    let finished = false;
    // Optional timeout per-job
    const timeoutMs = opts && opts.timeout ? Number(opts.timeout) : 0;
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        try { reject(new Error('job-timeout')); } catch (e) {}
        this.running -= 1;
        this._tryToStartNext();
      }, timeoutMs);
    }

    Promise.resolve()
      .then(() => task())
      .then((res) => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        reject(err);
      })
      .finally(() => {
        // allow next job to start
        this.running -= 1;
        this._tryToStartNext();
      });
  }
}

module.exports = JobQueue;
