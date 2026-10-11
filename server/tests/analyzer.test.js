const { analyzeWebsite, parseHTML } = require('../src/services/seoAnalyzer');
const { calculateScore } = require('../src/services/scoreCalculator');
const { generateRecommendations } = require('../src/services/recommendationEngine');

const html = `<!doctype html><html lang="en"><head><title>Useful page for search visitors</title><meta name="description" content="A useful description that explains the contents of this page for searchers."><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="canonical" href="https://example.test/page"><script type="application/ld+json">{"@type":"WebPage"}</script></head><body><h1>Page overview</h1><h2>Details</h2><img src="a.png"><img src="b.png" alt=""><a href="/internal">Internal</a><a href="https://other.example">External</a><a>Empty</a><p>Search content.</p></body></html>`;

describe('SEO parser and score', () => {
  test('extracts actual metadata, heading, image, link and JSON-LD metrics', () => {
    const { metrics } = parseHTML(html, 'https://example.test/page');
    expect(metrics.title.text).toBe('Useful page for search visitors');
    expect(metrics.description.present).toBe(true);
    expect(metrics.headings.h1Count).toBe(1);
    expect(metrics.images).toMatchObject({ total: 2, missingAlt: 1, emptyAlt: 1 });
    expect(metrics.links).toMatchObject({ internal: 1, external: 1, missingDestination: 1 });
    expect(metrics.structuredData.count).toBe(1);
    expect(metrics.visibleWordCount).toBeGreaterThan(0);
  });
  test('does not penalize a category that cannot be evaluated', () => {
    const { metrics } = parseHTML('<html lang="en"><head><title>One title</title></head><body><h1>Main</h1></body></html>');
    const score = calculateScore(metrics, 200);
    expect(score.breakdown.find((part) => part.category === 'images').status).toBe('not-evaluated');
    expect(score.value).toBeGreaterThanOrEqual(0);
    expect(score.value).toBeLessThanOrEqual(100);
  });
  test('produces recommendations from detected problems and concrete evidence', () => {
    const { metrics } = parseHTML('<html><head></head><body><img src="x"><h2>Section</h2></body></html>');
    const issues = generateRecommendations(metrics, 200);
    expect(issues.map((issue) => issue.issueId)).toEqual(expect.arrayContaining(['metadata.title-missing', 'images.alt-missing', 'content.h1-count']));
    expect(issues[0]).toHaveProperty('suggestedFix');
    expect(issues[0]).toHaveProperty('evidence');
  });
  test('detects a noindex signal from the response header', async () => {
    const report = await analyzeWebsite('https://example.test/page', {
      fetchWebsite: async () => ({ status: 200, responseTime: 20, finalUrl: 'https://example.test/page', html, headers: { 'x-robots-tag': 'noindex' } }),
      fetchTextResource: async () => ({ status: 404, text: '' }),
    });
    expect(report.metrics.indexability.blockedByMeta).toBe(true);
    expect(report.issues.map((issue) => issue.issueId)).toContain('technical.noindex');
  });
  test('runs the complete analyzer using a controlled HTML response', async () => {
    const report = await analyzeWebsite('https://example.test/page', {
      fetchWebsite: async () => ({ status: 200, responseTime: 45, finalUrl: 'https://example.test/page', html, bytes: Buffer.byteLength(html) }),
      fetchTextResource: async (url) => url.endsWith('/robots.txt')
        ? { status: 200, text: 'User-agent: *\nSitemap: https://example.test/sitemap.xml' }
        : { status: 200, text: '<urlset></urlset>' },
    });
    expect(report.httpStatus).toBe(200);
    expect(report.metrics.title.text).toBe('Useful page for search visitors');
    expect(report.metrics.robotsTxt.available).toBe(true);
    expect(report.metrics.sitemap.available).toBe(true);
    expect(report.score.value).toBeGreaterThan(0);
    expect(report.issues.some((issue) => issue.issueId === 'images.alt-missing')).toBe(true);
  });
});
