const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const { randomUUID } = require('node:crypto');
const { makeAuth } = require('./auth');
const { ScanRepository } = require('./repositories/scanRepository');
const { analyzeWebsite } = require('./services/seoAnalyzer');
const { validateTarget } = require('./services/securityValidation');
const { errorHandler } = require('./middleware/errorHandler');

const VERSION = require('../package.json').version;
const analyzeSchema = z.object({ url: z.string().trim().min(1).max(2048).url() }).strict();
const idSchema = z.string().uuid();

function createApp({ repository = new ScanRepository(), analyzer = analyzeWebsite, targetValidator = validateTarget, allowLocalWorkspace = ['development', 'test'].includes(process.env.NODE_ENV) } = {}) {
  const app = express();
  let activeScans = 0;
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  const origins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((value) => value.trim()).filter(Boolean);
  app.locals.allowedOrigins = origins;
  app.use(cors({ origin(origin, callback) { if (!origin || origins.includes(origin)) return callback(null, true); return callback(new Error('Origin is not allowed.')); }, credentials: true, methods: ['GET', 'POST', 'DELETE'], allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Confirm-Delete'], maxAge: 600 }));
  app.use(express.json({ limit: '8kb', strict: true }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }));
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'AUTH_RATE_LIMITED', message: 'Too many sign-in attempts. Try again later.' } } });
  const auth = makeAuth({ repository, isProduction: process.env.NODE_ENV === 'production', authLimiter });
  app.use('/api', auth.attach);
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', version: VERSION, storage: repository.mode || 'sqlite', workspace: allowLocalWorkspace ? 'local-development' : 'authenticated', authentication: true }));
  app.get('/api/ready', async (_req, res) => {
    try {
      if (typeof repository.check !== 'function') throw new Error('Readiness check is unavailable.');
      await repository.check();
      return res.json({ status: 'ready', storage: repository.mode || 'sqlite' });
    } catch {
      return res.status(503).json({ status: 'not_ready', storage: repository.mode || 'unknown' });
    }
  });
  app.get('/api/auth/session', auth.session);
  app.post('/api/auth/sign-in', auth.signIn);
  app.post('/api/auth/sign-out', auth.signOut);

  function requireWorkspace(req, res, next) {
    if (!req.user && !allowLocalWorkspace) return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in to use this workspace.' } });
    next();
  }
  app.use('/api/analyze', requireWorkspace);
  app.use('/api/reports', requireWorkspace);

  app.post('/api/analyze', async (req, res, next) => {
    if (req.user && !auth.verifyCsrf(req, res)) return;
    const parsed = analyzeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Provide a valid website URL using HTTP or HTTPS.' } });
    if (activeScans >= 4) return res.status(429).json({ error: { code: 'SCAN_CAPACITY', message: 'The scanner is busy. Please try again shortly.' } });
    activeScans += 1;
    try {
      try { await targetValidator(parsed.data.url); }
      catch (error) { return res.status(422).json({ error: { code: 'ANALYSIS_FAILED', message: error.message } }); }
      let result;
      try { result = await analyzer(parsed.data.url); }
      catch (error) {
        const expectedFailure = /not available|supported|valid website|embedded credentials|port is not supported|hostname could not be resolved|exceeded the size|timed out|redirected too many|did not return an HTML|could not be reached/i.test(error.message) || error.code === 'WEBSITE_UNAVAILABLE';
        if (!expectedFailure) return next(error);
        const message = error.code === 'WEBSITE_UNAVAILABLE' ? 'The website could not be reached or timed out.' : error.message;
        const failedReport = { id: randomUUID(), submittedUrl: parsed.data.url, finalUrl: null, scannedAt: new Date().toISOString(), status: 'failed', httpStatus: null, responseTimeMs: null, error: { code: 'ANALYSIS_FAILED', message }, score: { value: 0, outOf: 100, formula: 'No score was calculated because the page could not be fetched.', breakdown: [] }, scoreBreakdown: [], metrics: {}, issues: [], recommendations: [], limitations: [] };
        await repository.save(failedReport, req.user?.id || null);
        return res.status(422).json({ error: failedReport.error, report: failedReport });
      }
      result.id = randomUUID();
      await repository.save(result, req.user?.id || null);
      return res.status(201).json(result);
    } catch (error) {
      if (/not available|supported|valid website|embedded credentials|port is not supported|hostname could not be resolved|exceeded the size|timed out|redirected too many|did not return an HTML/i.test(error.message)) return res.status(422).json({ error: { code: 'ANALYSIS_FAILED', message: error.message } });
      if (error.code === 'WEBSITE_UNAVAILABLE') return res.status(422).json({ error: { code: 'ANALYSIS_FAILED', message: 'The website could not be reached or timed out.' } });
      return next(error);
    } finally { activeScans -= 1; }
  });

  app.get('/api/analyze/:scanId', async (req, res) => {
    if (!idSchema.safeParse(req.params.scanId).success) return res.status(400).json({ error: { code: 'INVALID_SCAN_ID', message: 'The report ID is invalid.' } });
    const scan = req.user ? await repository.getForOwner(req.params.scanId, req.user.id) : await repository.get(req.params.scanId);
    return scan ? res.json(scan) : res.status(404).json({ error: { code: 'REPORT_NOT_FOUND', message: 'No report was found for this ID.' } });
  });
  app.get('/api/reports', async (req, res) => res.json({ reports: req.user ? await repository.list(req.user.id) : await repository.list(undefined, true), storage: repository.mode }));
  app.get('/api/reports/:scanId', async (req, res) => {
    if (!idSchema.safeParse(req.params.scanId).success) return res.status(400).json({ error: { code: 'INVALID_SCAN_ID', message: 'The report ID is invalid.' } });
    const scan = req.user ? await repository.getForOwner(req.params.scanId, req.user.id) : await repository.get(req.params.scanId);
    return scan ? res.json(scan) : res.status(404).json({ error: { code: 'REPORT_NOT_FOUND', message: 'No report was found for this ID.' } });
  });
  app.delete('/api/reports', async (req, res) => {
    if (req.user) {
      if (!auth.verifyCsrf(req, res)) return;
      await repository.deleteForOwner(req.user.id);
      return res.status(204).end();
    }
    if (!allowLocalWorkspace) return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in to manage reports.' } });
    if (req.get('X-Confirm-Delete') !== 'local-history') return res.status(400).json({ error: { code: 'CONFIRMATION_REQUIRED', message: 'Confirm deletion of local scan history.' } });
    await repository.deleteAll();
    res.status(204).end();
  });

  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested API endpoint was not found.' } }));
  app.use(errorHandler);
  app.locals.repository = repository;
  return app;
}

module.exports = { createApp, analyzeSchema, VERSION };
