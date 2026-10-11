const http = require('node:http');
const https = require('node:https');
const { validateTarget } = require('./securityValidation');

const MAX_HTML_BYTES = 1_500_000;
const MAX_REDIRECTS = 4;
const REQUEST_TIMEOUT_MS = 10_000;

function requestOnce(target, addresses, maxBytes, timeoutMs) {
  return new Promise((resolve, reject) => {
    const transport = target.url.protocol === 'https:' ? https : http;
    const lookup = (_hostname, options, callback) => {
      if (options?.all) return callback(null, addresses.map((item) => ({ ...item })));
      const selected = addresses[0];
      callback(null, selected.address, selected.family);
    };
    const agent = new (target.url.protocol === 'https:' ? https.Agent : http.Agent)({ keepAlive: false, lookup });
    let timer;
    const req = transport.request(target.url, {
      method: 'GET', agent, timeout: timeoutMs,
      headers: { 'user-agent': 'PagePulseBot/1.0 (+https://page-pulse.local; SEO audit)', accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1', 'accept-encoding': 'identity' },
    }, (res) => {
      const chunks = [];
      let size = 0;
      const contentLength = Number(res.headers['content-length']);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) { req.destroy(new Error('The website response exceeded the size limit.')); return; }
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) { req.destroy(new Error('The website response exceeded the size limit.')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => { clearTimeout(timer); resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks), location: res.headers.location }); });
      res.on('aborted', () => { clearTimeout(timer); reject(new Error('The website response ended unexpectedly.')); });
    });
    timer = setTimeout(() => req.destroy(new Error('The website request timed out.')), timeoutMs);
    timer.unref?.();
    req.on('timeout', () => req.destroy(new Error('The website request timed out.')));
    req.on('error', (error) => { clearTimeout(timer); reject(error); });
    req.end();
  });
}

async function fetchWebsite(input, options = {}) {
  const started = Date.now();
  let current = input;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const target = await validateTarget(current, options.lookup);
    let response;
    try { response = await (options.requestOnce || requestOnce)(target, target.addresses, options.maxBytes || MAX_HTML_BYTES, options.timeoutMs || REQUEST_TIMEOUT_MS); }
    catch (error) {
      if (/size limit|timed out/.test(error.message)) throw error;
      const safeError = new Error('The website could not be reached or timed out.'); safeError.code = 'WEBSITE_UNAVAILABLE'; throw safeError;
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.location) throw new Error('The website returned an invalid redirect.');
      if (redirects === MAX_REDIRECTS) throw new Error('The website redirected too many times.');
      current = new URL(response.location, target.url).toString();
      continue;
    }
    const contentType = String(response.headers['content-type'] || '').toLowerCase();
    const contentEncoding = String(response.headers['content-encoding'] || 'identity').toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) throw new Error('The destination did not return an HTML page.');
    if (contentEncoding !== 'identity') throw new Error('Compressed responses are not supported by this scanner.');
    return { ...response, finalUrl: target.url.toString(), responseTime: Date.now() - started, bytes: response.body.length, html: response.body.toString('utf8') };
  }
  throw new Error('The website could not be fetched safely.');
}

async function fetchTextResource(input, options = {}) {
  const target = await validateTarget(input, options.lookup);
  const response = await (options.requestOnce || requestOnce)(target, target.addresses, options.maxBytes || 100_000, options.timeoutMs || 4_000);
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const next = new URL(response.location || '', target.url);
    const checked = await validateTarget(next.toString(), options.lookup);
    const final = await (options.requestOnce || requestOnce)(checked, checked.addresses, options.maxBytes || 100_000, options.timeoutMs || 4_000);
    return { status: final.status, text: final.body.toString('utf8'), url: checked.url };
  }
  return { status: response.status, text: response.body.toString('utf8'), url: target.url };
}

module.exports = { fetchWebsite, fetchTextResource, MAX_HTML_BYTES, MAX_REDIRECTS, REQUEST_TIMEOUT_MS };
