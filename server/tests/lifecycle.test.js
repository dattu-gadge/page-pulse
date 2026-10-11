const express = require('express');
const { start } = require('../server');

describe('server shutdown lifecycle', () => {
  test('closes partially initialized storage when startup fails', async () => {
    let closes = 0;
    const repository = { init: async () => { throw new Error('connection failed'); }, close: async () => { closes += 1; } };
    await expect(start({ repository, registerSignals: false })).rejects.toThrow('connection failed');
    expect(closes).toBe(1);
  });

  test('closes initialized storage when listen fails synchronously', async () => {
    let closes = 0;
    const repository = { init: async () => {}, close: async () => { closes += 1; } };
    const app = { listen: () => { throw new Error('listen failed'); } };
    await expect(start({ repository, app, registerSignals: false })).rejects.toThrow('listen failed');
    expect(closes).toBe(1);
  });

  test('stops accepting requests, waits for in-flight requests, and closes storage once', async () => {
    let finishRequest;
    const requestGate = new Promise((resolve) => { finishRequest = resolve; });
    let closes = 0;
    const repository = { mode: 'test', init: async () => {}, close: async () => { closes += 1; } };
    const app = express();
    app.get('/slow', async (_req, res) => { await requestGate; res.end('finished'); });
    const service = await start({ repository, app, port: 0, host: '127.0.0.1', registerSignals: false, shutdownTimeoutMs: 500 });
    const responsePromise = fetch(`http://127.0.0.1:${service.port}/slow`);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const shutdownA = service.shutdown();
    const shutdownB = service.shutdown();
    expect(shutdownA).toBe(shutdownB);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(closes).toBe(0);
    finishRequest();
    expect(await (await responsePromise).text()).toBe('finished');
    await shutdownA;
    expect(closes).toBe(1);
  });

  test('bounds drain time and closes storage after forced connection close', async () => {
    let finishRequest;
    const requestGate = new Promise((resolve) => { finishRequest = resolve; });
    let closes = 0;
    const repository = { mode: 'test', init: async () => {}, close: async () => { closes += 1; } };
    const app = express();
    app.get('/slow', async (_req, res) => { await requestGate; res.end('finished'); });
    const service = await start({ repository, app, port: 0, host: '127.0.0.1', registerSignals: false, shutdownTimeoutMs: 30 });
    const responsePromise = fetch(`http://127.0.0.1:${service.port}/slow`).catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await service.shutdown();
    expect(closes).toBe(1);
    await responsePromise;
    finishRequest();
  });
});
