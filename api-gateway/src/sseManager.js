'use strict';
/**
 * SSE Manager — broadcasts Redis Stream events to connected dashboard clients.
 */

class SseManager {
  constructor() {
    this._clients = new Set();
  }

  addClient(reply) {
    this._clients.add(reply);
    reply.raw.on('close', () => this._clients.delete(reply));
  }

  broadcast(data) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    const message = `data: ${payload}\n\n`;
    for (const client of this._clients) {
      try {
        client.raw.write(message);
      } catch {
        this._clients.delete(client);
      }
    }
  }

  get clientCount() {
    return this._clients.size;
  }
}

module.exports = { SseManager };
