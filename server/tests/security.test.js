const { isPublicAddress, resolvePublicHost, validateTarget } = require('../src/services/securityValidation');
const { fetchWebsite } = require('../src/services/fetchWebsite');

describe('SSRF validation', () => {
  test.each(['127.0.0.1', '10.2.3.4', '169.254.169.254', '192.168.1.2', '224.0.0.1', '0.0.0.0', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1'])('rejects non-public address %s', (ip) => expect(isPublicAddress(ip)).toBe(false));
  test('accepts a public address', () => expect(isPublicAddress('93.184.216.34')).toBe(true));
  test('rejects internal hostnames, credentials, unsafe protocols and ports', async () => {
    await expect(validateTarget('http://metadata.google.internal')).rejects.toThrow();
    await expect(validateTarget('https://user:pass@example.com')).rejects.toThrow();
    await expect(validateTarget('file:///etc/passwd')).rejects.toThrow();
    await expect(validateTarget('http://example.com:8080')).rejects.toThrow();
  });
  test('rejects hostnames resolving to a private address', async () => {
    await expect(resolvePublicHost('public.example', async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.2', family: 4 }])).rejects.toThrow('not available');
  });
  test('revalidates redirects before the next connection', async () => {
    const requested = [];
    const requestOnce = async (target) => {
      requested.push(target.url.hostname);
      return { status: 302, headers: {}, body: Buffer.alloc(0), location: 'http://127.0.0.1/admin' };
    };
    await expect(fetchWebsite('https://public.example', { lookup: async () => [{ address: '93.184.216.34', family: 4 }], requestOnce })).rejects.toThrow('not available');
    expect(requested).toEqual(['public.example']);
  });
  test('stops after the configured redirect limit', async () => {
    let count = 0;
    await expect(fetchWebsite('https://public.example', {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      requestOnce: async () => ({ status: 302, headers: {}, body: Buffer.alloc(0), location: `https://public.example/redirect-${++count}` }),
    })).rejects.toThrow('redirected too many times');
    expect(count).toBe(5);
  });
  test('enforces the response size cap and reports request timeouts', async () => {
    await expect(fetchWebsite('https://public.example', { lookup: async () => [{ address: '93.184.216.34', family: 4 }], requestOnce: async () => { throw new Error('The website response exceeded the size limit.'); } })).rejects.toThrow('size limit');
    await expect(fetchWebsite('https://public.example', { lookup: async () => [{ address: '93.184.216.34', family: 4 }], requestOnce: async () => { throw new Error('The website request timed out.'); } })).rejects.toThrow('timed out');
  });
  test('surfaces DNS failures without internal error details', async () => {
    await expect(resolvePublicHost('missing.example', async () => { const error = new Error('private resolver details'); error.code = 'ENOTFOUND'; throw error; })).rejects.toThrow('could not be resolved');
  });
  test('bounds DNS resolution time', async () => {
    await expect(resolvePublicHost('slow.example', () => new Promise(() => {}), 2)).rejects.toThrow('could not be resolved');
  });
});
