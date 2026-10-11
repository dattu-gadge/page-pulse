function errorHandler(error, _req, res, _next) {
  if (res.headersSent) return;
  const status = Number(error.statusCode || error.status) || 500;
  if (error instanceof SyntaxError && status === 400) return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'The request body is not valid JSON.' } });
  if (status >= 500) console.error(JSON.stringify({ level: 'error', message: 'Request failed', code: error.code || 'INTERNAL_ERROR' }));
  res.status(status).json({ error: { code: error.code || 'REQUEST_FAILED', message: status >= 500 ? 'The request could not be completed.' : error.message } });
}

module.exports = { errorHandler };
