const { classifyStartupError, formatStartupFailure } = require('../src/startupDiagnostics');

describe('sanitized startup diagnostics', () => {
  test.each([
    ['DATABASE_URL is required when NODE_ENV=production', 'configuration'],
    ['Remove TLS query parameters from DATABASE_URL and configure TLS with DATABASE_SSL.', 'connection-string'],
    ['PostgreSQL schema is not initialized. Run the explicit database migration before starting the API.', 'migration'],
    ['password leaked in internal message', 'database'],
  ])('classifies %s', (message, expected) => {
    expect(classifyStartupError(new Error(message))).toBe(expected);
  });

  test('identifies TLS, authentication, permission, and network failures without logging details', () => {
    expect(classifyStartupError(Object.assign(new Error('certificate detail'), { code: 'CERT_HAS_EXPIRED' }))).toBe('database-tls');
    expect(classifyStartupError(Object.assign(new Error('private auth detail'), { code: '28P01' }))).toBe('database-authentication');
    expect(classifyStartupError(Object.assign(new Error('private permission detail'), { code: '42501' }))).toBe('database-permission');
    expect(classifyStartupError(Object.assign(new Error('private network detail'), { code: 'ECONNREFUSED' }))).toBe('database-network');
  });

  test('formats a failure without the error message or connection string', () => {
    const log = formatStartupFailure(Object.assign(new Error('postgres://user:secret@db.example/private'), { code: 'ECONNREFUSED' }));
    expect(log).toContain('[database-network] (ECONNREFUSED)');
    expect(log).not.toContain('secret');
    expect(log).not.toContain('db.example');
  });
});
