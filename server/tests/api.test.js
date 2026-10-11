const request = require('supertest');
const { createApp } = require('../src/app');
const { analyzeWebsite } = require('../src/services/seoAnalyzer');

function memoryRepository() {
  const data = new Map();
  return { mode: 'test-memory', check: async () => true, save: async (scan) => { data.set(scan.id, scan); return scan; }, get: async (id) => data.get(id) || null, list: async () => [...data.values()], deleteAll: async () => data.clear() };
}

describe('API', () => {
  const repository = memoryRepository();
  const app = createApp({ repository, targetValidator: async (url) => { if (!/^https?:\/\//i.test(url)) throw new Error('Only HTTP and HTTPS websites can be analyzed.'); return {}; }, analyzer: async (url) => ({ submittedUrl: url, scannedAt: new Date().toISOString(), score: { value: 80 }, status: 'completed', metrics: {}, issues: [] }) });

  test('trusts exactly one configured reverse-proxy hop and keeps API rate limiting enabled', async () => {
    const previousTrustProxy = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = 'true';
    try {
      const proxyApp = createApp({ repository });
      expect(proxyApp.get('trust proxy')).toBe(1);
      for (let index = 0; index < 30; index += 1) await request(proxyApp).get('/api/health').expect(200);
      await request(proxyApp).get('/api/health').expect(429);
    } finally {
      if (previousTrustProxy === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = previousTrustProxy;
    }
  });

  test('health does not expose credentials', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).not.toHaveProperty('env');
  });
  test('readiness checks the repository without exposing database errors', async () => {
    await request(app).get('/api/ready').expect(200, { status: 'ready', storage: 'test-memory' });
    const failingApp = createApp({ repository: { mode: 'postgres', check: async () => { throw new Error('private connection detail'); } } });
    await request(failingApp).get('/api/ready').expect(503, { status: 'not_ready', storage: 'postgres' });
  });
  test('rejects unauthenticated scan and report requests when local access is off', async () => {
    const restrictedApp = createApp({ repository, allowLocalWorkspace: false });
    await request(restrictedApp).get('/api/health').expect(200).expect((res) => expect(res.body.workspace).toBe('authenticated'));
    await request(restrictedApp).get('/api/reports').expect(401);
    await request(restrictedApp).post('/api/analyze').send({ url: 'https://example.com' }).expect(401);
  });
  test('validates input, protocol and SSRF targets', async () => {
    await request(app).post('/api/analyze').send({}).expect(400);
    await request(app).post('/api/analyze').send({ url: 'ftp://example.com' }).expect(422);
    const guardedApp = createApp({ repository, targetValidator: async () => { throw new Error('This destination is not available for analysis.'); } });
    await request(guardedApp).post('/api/analyze').send({ url: 'http://127.0.0.1' }).expect(422);
  });
  test('saves a valid scan and retrieves its actual report', async () => {
    const response = await request(app).post('/api/analyze').send({ url: 'https://example.com' }).expect(201);
    expect(response.body.score.value).toBe(80);
    await request(app).get(`/api/reports/${response.body.id}`).expect(200, response.body);
    const list = await request(app).get('/api/reports').expect(200);
    expect(list.body.reports).toHaveLength(1);
  });
  test('returns a clear 404 for a valid but missing report ID', async () => {
    await request(app).get('/api/reports/00000000-0000-4000-8000-000000000000')
      .expect(404)
      .expect({ error: { code: 'REPORT_NOT_FOUND', message: 'No report was found for this ID.' } });
  });
  test('integrates the real analyzer with the API using a controlled HTML page', async () => {
    const html = '<!doctype html><html lang="en"><head><title>Controlled test page</title><meta name="description" content="A controlled description for analyzer integration tests."><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>Test page</h1><img src="test.png"><p>Real parsed words from a controlled page.</p></body></html>';
    const controlledRepository = memoryRepository();
    const integratedApp = createApp({
      repository: controlledRepository,
      targetValidator: async () => ({}),
      analyzer: (url) => analyzeWebsite(url, {
        fetchWebsite: async () => ({ status: 200, responseTime: 32, finalUrl: url, bytes: Buffer.byteLength(html), html, headers: {} }),
        fetchTextResource: async (resourceUrl) => resourceUrl.endsWith('/robots.txt') ? { status: 404, text: '' } : { status: 404, text: '' },
      }),
    });
    const response = await request(integratedApp).post('/api/analyze').send({ url: 'https://controlled.example/test' }).expect(201);
    expect(response.body.metrics.title.text).toBe('Controlled test page');
    expect(response.body.metrics.images.missingAlt).toBe(1);
    expect(response.body.issues.some((issue) => issue.issueId === 'images.alt-missing')).toBe(true);
    await request(integratedApp).get(`/api/reports/${response.body.id}`).expect(200, response.body);
  });
  test('rejects untrusted origins', async () => {
    await request(app).get('/api/health').set('Origin', 'https://untrusted.example').expect(500);
  });
  test('requires explicit confirmation to clear local history', async () => {
    await request(app).delete('/api/reports').expect(400);
    await request(app).delete('/api/reports').set('X-Confirm-Delete', 'local-history').expect(204);
  });
  test('persists a failed fetch with its safe error detail', async () => {
    const failedRepository = memoryRepository();
    const failingApp = createApp({ repository: failedRepository, targetValidator: async () => ({}), analyzer: async () => { throw new Error('The website request timed out.'); } });
    const response = await request(failingApp).post('/api/analyze').send({ url: 'https://example.com' }).expect(422);
    expect(response.body.report.status).toBe('failed');
    expect(response.body.report.error.message).toMatch(/timed out/);
    expect((await request(failingApp).get('/api/reports').expect(200)).body.reports).toHaveLength(1);
  });
});
