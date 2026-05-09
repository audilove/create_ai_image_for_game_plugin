'use strict';

const { Queue, Worker, QueueEvents } = require('bullmq');

function parseRedisConnection() {
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  return { url: redisUrl };
}

class GenerationQueue {
  constructor(options = {}) {
    this.queueName = options.queueName || process.env.GENERATION_QUEUE_NAME || 'image-generation';
    this.concurrency = Math.max(
      1,
      Number(options.concurrency || process.env.GENERATION_QUEUE_CONCURRENCY || 2),
    );
    this.connection = options.connection || parseRedisConnection();

    this.queue = new Queue(this.queueName, { connection: this.connection });
    this.queueEvents = new QueueEvents(this.queueName, { connection: this.connection });
    this.worker = null;
  }

  async start(handler) {
    if (this.worker) return;
    if (typeof handler !== 'function') {
      throw new Error('[GenerationQueue] handler must be a function.');
    }
    this.worker = new Worker(
      this.queueName,
      async (job) => handler(job.name, job.data),
      {
        connection: this.connection,
        concurrency: this.concurrency,
      },
    );
  }

  async enqueue(name, data, options = {}) {
    return this.queue.add(name, data, {
      removeOnComplete: options.removeOnComplete ?? true,
      removeOnFail: options.removeOnFail ?? 500,
      attempts: options.attempts ?? 1,
      backoff: options.backoff,
    });
  }

  async close() {
    await Promise.allSettled([
      this.worker ? this.worker.close() : Promise.resolve(),
      this.queueEvents.close(),
      this.queue.close(),
    ]);
    this.worker = null;
  }
}

module.exports = GenerationQueue;
module.exports.GenerationQueue = GenerationQueue;
