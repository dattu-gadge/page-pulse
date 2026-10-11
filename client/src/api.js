const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
let csrfToken = '';
let sessionRequest = null;

function validatePayload(path, payload) {
  if (path === '/api/health' && (!payload || payload.status !== 'ok' || typeof payload.version !== 'string')) throw new Error('The API returned an unexpected health response.');
  if (path === '/api/reports' && (!payload || !Array.isArray(payload.reports) || !payload.reports.every((scan) => typeof scan.id === 'string' && typeof scan.submittedUrl === 'string'))) throw new Error('The API returned an unexpected reports response.');
  const isSingleReport = path === '/api/analyze' || /^\/api\/(?:analyze|reports)\/[^/]+$/.test(path);
  if (isSingleReport && (!payload || typeof payload.id !== 'string' || typeof payload.submittedUrl !== 'string' || !payload.score || typeof payload.score.value !== 'number' || !Array.isArray(payload.issues))) throw new Error('The API returned an unexpected report response.');
  return payload;
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(['POST', 'DELETE'].includes(options.method) && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}), ...options.headers },
    signal: options.signal,
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || 'Page Pulse could not complete that request.')
    error.status = response.status
    error.code = payload.error?.code
    if (payload.report) error.report = payload.report
    throw error
  }
  return validatePayload(path, payload);
}

export const api = {
  health: (signal) => request('/api/health', { signal }),
  session: (signal) => {
    if (!sessionRequest) sessionRequest = request('/api/auth/session', { signal }).then((result) => { csrfToken = result.csrfToken || ''; return result }).finally(() => { sessionRequest = null });
    return sessionRequest;
  },
  signIn: async (email, password) => { const result = await request('/api/auth/sign-in', { method: 'POST', body: JSON.stringify({ email, password }) }); csrfToken = result.csrfToken || ''; return result },
  signOut: () => request('/api/auth/sign-out', { method: 'POST', body: '{}' }),
  analyze: (url, signal) => request('/api/analyze', { method: 'POST', body: JSON.stringify({ url }), signal }),
  reports: (signal) => request('/api/reports', { signal }),
  report: (id, signal) => request(`/api/reports/${encodeURIComponent(id)}`, { signal }),
  clearReports: () => request('/api/reports', { method: 'DELETE', headers: { 'X-Confirm-Delete': 'local-history' } }),
};

export function normalizeWebsiteUrl(input) {
  const value = input.trim();
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let parsed;
  try { parsed = new URL(candidate); } catch { throw new Error('Enter a valid website address, such as example.com.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw new Error('Enter a public website URL using HTTP or HTTPS.');
  return parsed.toString();
}
