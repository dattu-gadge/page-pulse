function classifyStartupError(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  const message = typeof error?.message === 'string' ? error.message : '';

  if (/DATABASE_URL is required|DATABASE_SSL must be explicitly|DATABASE_URL must be|DATABASE_SSL must be|DATABASE_SSL=true is required/.test(message)) return 'configuration';
  if (/TLS query parameters/.test(message)) return 'connection-string';
  if (/schema is not initialized|migration before starting/.test(message)) return 'migration';
  if (/^(28|28P01)/.test(code)) return 'database-authentication';
  if (code === '42501') return 'database-permission';
  if (/^(08|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)/.test(code)) return 'database-network';
  if (/CERT_|ERR_TLS|SELF_SIGNED_CERT|UNABLE_TO_VERIFY|DEPTH_ZERO_SELF_SIGNED/.test(code)) return 'database-tls';
  if (/^42/.test(code)) return 'database-schema';
  return 'database';
}

function formatStartupFailure(error, phase = 'Startup') {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? ` (${error.code})` : '';
  return `${phase} failed [${classifyStartupError(error)}]${code}. Check the sanitized configuration guidance; no connection details were logged.`;
}

module.exports = { classifyStartupError, formatStartupFailure };
