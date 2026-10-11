const { createApp } = require('./src/app');
const { ScanRepository } = require('./src/repositories/scanRepository');
const { once } = require('node:events');

async function start({ repository = new ScanRepository(), app = null, port = Number(process.env.PORT) || 5000, host = '0.0.0.0', shutdownTimeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10_000, registerSignals = true } = {}) {
  try { await repository.init(); }
  catch (error) { await repository.close().catch(() => {}); throw error; }
  const server = (app || createApp({ repository })).listen(port, host);
  try { await once(server, 'listening'); }
  catch (error) { await repository.close().catch(() => {}); throw error; }
  const actualPort = server.address()?.port;
  console.log(`Page Pulse API listening on port ${actualPort} (${repository.mode} storage)`);
  let shutdownPromise;
  const shutdown = () => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      let timer;
      const closed = new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      const boundedTimeout = Number.isFinite(shutdownTimeoutMs) ? Math.max(1, Math.min(shutdownTimeoutMs, 25_000)) : 10_000;
      timer = setTimeout(() => server.closeAllConnections?.(), boundedTimeout);
      try { await closed; }
      finally { clearTimeout(timer); }
      await repository.close();
      if (registerSignals) {
        process.removeListener('SIGTERM', onSigterm);
        process.removeListener('SIGINT', onSigint);
      }
    })();
    return shutdownPromise;
  };
  const onSignal = (signal) => {
    console.log(`Received ${signal}; draining HTTP requests before closing storage.`);
    shutdown().catch(() => { process.exitCode = 1; });
  };
  const onSigterm = () => onSignal('SIGTERM');
  const onSigint = () => onSignal('SIGINT');
  if (registerSignals) {
    process.on('SIGTERM', onSigterm);
    process.on('SIGINT', onSigint);
  }
  return { server, repository, shutdown, port: actualPort };
}

if (require.main === module) start().catch((error) => { console.error(`Startup failed (${error.code || 'STARTUP_FAILED'}). Check database and environment configuration; connection details were withheld.`); process.exitCode = 1; });

module.exports = { start };
