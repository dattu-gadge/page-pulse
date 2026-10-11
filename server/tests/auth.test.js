const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { randomUUID } = require('node:crypto');
const { createApp } = require('../src/app');
const { ScanRepository } = require('../src/repositories/scanRepository');
const { provisionUser } = require('../src/auth');

describe('authentication and report ownership', () => {
  let directory;
  let repository;
  let app;
  let alice;
  let bob;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'page-pulse-auth-'));
    repository = new ScanRepository({ databaseUrl: '', filePath: path.join(directory, 'auth.sqlite') });
    await repository.init();
    alice = await provisionUser(repository, 'alice@example.test', 'a-long-test-password-1');
    bob = await provisionUser(repository, 'bob@example.test', 'a-long-test-password-2');
    app = createApp({ repository, allowLocalWorkspace: false, targetValidator: async () => ({}), analyzer: async (url) => ({ submittedUrl: url, scannedAt: new Date().toISOString(), score: { value: 73 }, status: 'completed', metrics: {}, issues: [] }) });
  });

  afterEach(async () => { await repository.close(); await fs.rm(directory, { recursive: true, force: true }); });

  async function signedIn(user, password) {
    const agent = request.agent(app);
    const guest = await agent.get('/api/auth/session').expect(200);
    const response = await agent.post('/api/auth/sign-in').set('X-CSRF-Token', guest.body.csrfToken).send({ email: user.email, password }).expect(200);
    return { agent, csrfToken: response.body.csrfToken };
  }

  function scan(ownerId, url) {
    return { id: randomUUID(), scannedAt: new Date().toISOString(), submittedUrl: url, score: { value: 60 }, status: 'completed', issues: [] };
  }

  test('rejects unauthenticated workspace reads and writes', async () => {
    await request(app).get('/api/reports').expect(401);
    await request(app).post('/api/analyze').send({ url: 'https://public.example' }).expect(401);
    await request(app).get(`/api/reports/${randomUUID()}`).expect(401);
    await request(app).delete('/api/reports').expect(401);
  });

  test('valid sign-in returns a persistent session and sign-out invalidates it', async () => {
    const { agent, csrfToken } = await signedIn(alice, 'a-long-test-password-1');
    const storedUser = await repository.getUserByEmail(alice.email);
    expect(storedUser.passwordHash).toMatch(/^scrypt\$32768\$/);
    expect(storedUser.passwordHash).not.toContain('a-long-test-password-1');
    expect((await agent.get('/api/auth/session').expect(200)).body).toMatchObject({ authenticated: true, user: { email: alice.email } });
    await agent.post('/api/auth/sign-out').set('X-CSRF-Token', csrfToken).expect(200);
    await agent.get('/api/auth/session').expect(200).expect((response) => expect(response.body.authenticated).toBe(false));
    await agent.get('/api/reports').expect(401);
  });

  test('rejects malformed credentials, invalid passwords, bad CSRF tokens and invalid sessions', async () => {
    const agent = request.agent(app);
    await agent.get('/api/auth/session').expect(200);
    await agent.post('/api/auth/sign-in').send({ email: 'not-an-email', password: 'x' }).expect(403);
    const guest = await agent.get('/api/auth/session').expect(200);
    await agent.post('/api/auth/sign-in').set('X-CSRF-Token', guest.body.csrfToken).send({ email: alice.email, password: '' }).expect(400);
    await agent.post('/api/auth/sign-in').set('X-CSRF-Token', guest.body.csrfToken).send({ email: alice.email, password: 'wrong-password-123' }).expect(401);
    await request(app).get('/api/reports').set('Cookie', 'pagepulse_session=invalid-token').expect(401);
  });

  test('rate limits repeated sign-in attempts', async () => {
    const agent = request.agent(app);
    const guest = await agent.get('/api/auth/session').expect(200);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await agent.post('/api/auth/sign-in').set('X-CSRF-Token', guest.body.csrfToken).send({ email: alice.email, password: 'incorrect-password' }).expect(401);
    }
    await agent.post('/api/auth/sign-in').set('X-CSRF-Token', guest.body.csrfToken).send({ email: alice.email, password: 'incorrect-password' }).expect(429);
  });

  test('scopes report lists, retrieval, deletion, and new scans to the authenticated owner', async () => {
    const aliceScan = scan(alice.id, 'https://alice.example');
    const bobScan = scan(bob.id, 'https://bob.example');
    await repository.save(aliceScan, alice.id);
    await repository.save(bobScan, bob.id);
    const aliceSession = await signedIn(alice, 'a-long-test-password-1');
    const bobSession = await signedIn(bob, 'a-long-test-password-2');
    await aliceSession.agent.get('/api/reports').expect(200).expect((response) => expect(response.body.reports.map((item) => item.id)).toEqual([aliceScan.id]));
    await aliceSession.agent.get(`/api/reports/${bobScan.id}`).expect(404);
    await aliceSession.agent.get(`/api/analyze/${bobScan.id}`).expect(404);
    await aliceSession.agent.delete('/api/reports').set('X-CSRF-Token', aliceSession.csrfToken).expect(204);
    expect(await repository.get(bobScan.id)).not.toBeNull();
    const created = await bobSession.agent.post('/api/analyze').set('X-CSRF-Token', bobSession.csrfToken).send({ url: 'https://public.example' }).expect(201);
    expect((await repository.getForOwner(created.body.id, bob.id)).id).toBe(created.body.id);
    expect(await repository.getForOwner(created.body.id, alice.id)).toBeNull();
  });
});
