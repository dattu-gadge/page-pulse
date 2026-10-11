const dns = require('node:dns/promises');
const net = require('node:net');
const ipaddr = require('ipaddr.js');

const SAFE_PORTS = new Set([80, 443]);

function isPublicAddress(address) {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address();
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}

async function resolvePublicHost(hostname, lookup = dns.lookup, timeoutMs = 5_000) {
  const host = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!host || !host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('This hostname is not available for analysis.');
  }
  if (net.isIP(host)) {
    if (!isPublicAddress(host)) throw new Error('This destination is not available for analysis.');
    return [{ address: host, family: net.isIP(host) }];
  }
  let records;
  let timer;
  try {
    records = await Promise.race([lookup(host, { all: true, verbatim: true }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DNS lookup timed out.')), timeoutMs); })]);
  } catch { throw new Error('The website hostname could not be resolved.'); }
  finally { clearTimeout(timer); }
  if (!records.length || records.some((record) => !isPublicAddress(record.address))) {
    throw new Error('This destination is not available for analysis.');
  }
  return records;
}

async function validateTarget(input, lookup) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Enter a valid website URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS websites can be analyzed.');
  if (url.username || url.password) throw new Error('URLs with embedded credentials are not supported.');
  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
  if (!SAFE_PORTS.has(port)) throw new Error('This website port is not supported.');
  const addresses = await resolvePublicHost(url.hostname, lookup);
  return { url, addresses };
}

module.exports = { SAFE_PORTS, isPublicAddress, resolvePublicHost, validateTarget };
