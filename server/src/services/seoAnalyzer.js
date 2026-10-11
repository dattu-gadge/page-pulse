const cheerio = require('cheerio');
const { fetchWebsite, fetchTextResource } = require('./fetchWebsite');
const { calculateScore } = require('./scoreCalculator');
const { generateRecommendations } = require('./recommendationEngine');

function parseHTML(html, pageUrlInput = 'https://page-pulse.invalid') {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim();
  const description = $('meta[name="description" i]').first().attr('content')?.trim() || '';
  const h1s = $('h1').map((_, node) => $(node).text().trim()).get();
  const images = $('img').map((_, node) => ({ src: $(node).attr('src') || '', altPresent: $(node).is('[alt]'), alt: $(node).attr('alt') ?? null })).get();
  const base = $('base[href]').first().attr('href');
  let pageUrl;
  try { pageUrl = new URL(base || pageUrlInput, pageUrlInput); } catch { pageUrl = new URL(pageUrlInput); }
  const links = $('a').map((_, node) => {
    const href = ($(node).attr('href') || '').trim();
    if (!href) return { href: '', kind: 'missing' };
    try { const parsed = new URL(href, pageUrl); return { href, kind: parsed.origin === pageUrl.origin ? 'internal' : 'external' }; }
    catch { return { href, kind: 'invalid' }; }
  }).get();
  const jsonLd = [];
  let invalidJsonLd = 0;
  $('script[type="application/ld+json"]').each((_, node) => {
    try { jsonLd.push(JSON.parse($(node).contents().text())); } catch { invalidJsonLd += 1; }
  });
  const robots = $('meta[name="robots" i], meta[name="googlebot" i]').map((_, el) => $(el).attr('content') || '').get().join(', ');
  $('script, style, noscript, template, svg').remove();
  const visibleText = $('body').text().replace(/\s+/g, ' ').trim();
  const metrics = {
    title: { present: Boolean(title), text: title, characters: title.length, status: !title ? 'fail' : title.length < 30 || title.length > 60 ? 'warning' : 'pass' },
    description: { present: Boolean(description), text: description, characters: description.length, status: !description ? 'fail' : description.length < 70 || description.length > 160 ? 'warning' : 'pass' },
    headings: { h1Count: h1s.length, h1Text: h1s, h2Count: $('h2').length, h3Count: $('h3').length, skippedLevels: $('h3').toArray().some((node) => $(node).prevAll('h2').length === 0) },
    images: { total: images.length, missingAlt: images.filter((image) => !image.altPresent).length, emptyAlt: images.filter((image) => image.altPresent && !image.alt).length, samples: images.slice(0, 50) },
    links: { internal: links.filter((link) => link.kind === 'internal').length, external: links.filter((link) => link.kind === 'external').length, missingDestination: links.filter((link) => link.kind === 'missing' || link.kind === 'invalid').length },
    canonical: $('link[rel="canonical"]').first().attr('href') || null,
    robotsMeta: robots || null,
    language: $('html').attr('lang') || null,
    viewport: $('meta[name="viewport"]').attr('content') || null,
    openGraph: { title: $('meta[property="og:title"]').attr('content') || null, description: $('meta[property="og:description"]').attr('content') || null, image: $('meta[property="og:image"]').attr('content') || null },
    structuredData: { count: jsonLd.length, invalidCount: invalidJsonLd },
    visibleWordCount: visibleText ? visibleText.split(/\s+/).filter(Boolean).length : 0,
    htmlBytes: Buffer.byteLength(html),
    indexability: { signals: robots || null, blockedByMeta: /(?:^|[\s,:;])(?:noindex|none)(?:$|[\s,:;])/i.test(robots), checked: true },
  };
  return { metrics, evidence: { title: metrics.title, description: metrics.description, h1Count: h1s.length, missingAlt: metrics.images.missingAlt, emptyAlt: metrics.images.emptyAlt, canonical: metrics.canonical, language: metrics.language, viewport: metrics.viewport, robots: metrics.robotsMeta, skippedHeadingLevels: metrics.headings.skippedLevels, linkErrors: metrics.links.missingDestination, invalidJsonLd: invalidJsonLd } };
}

async function analyzeWebsite(input, options = {}) {
  const fetched = await (options.fetchWebsite || fetchWebsite)(input, options.fetchOptions);
  const { metrics, evidence } = parseHTML(fetched.html, fetched.finalUrl);
  metrics.htmlBytes = fetched.bytes ?? Buffer.byteLength(fetched.html);
  const page = new URL(fetched.finalUrl);
  const robotsHeader = String(fetched.headers?.['x-robots-tag'] || '').trim();
  metrics.robotsHeader = robotsHeader || null;
  metrics.indexability.signals = [metrics.robotsMeta, robotsHeader].filter(Boolean).join(', ') || null;
  metrics.indexability.blockedByMeta = /(?:^|[\s,:;])(?:noindex|none)(?:$|[\s,:;])/i.test(metrics.indexability.signals || '');
  evidence.robots = metrics.indexability.signals;
  let robotsTxt = { evaluated: false, available: null, sitemap: null };
  try {
    const robotsResponse = await (options.fetchTextResource || fetchTextResource)(new URL('/robots.txt', page).toString(), { lookup: options.fetchOptions?.lookup });
    robotsTxt = { evaluated: true, available: robotsResponse.status >= 200 && robotsResponse.status < 300, sitemap: (robotsResponse.text.match(/^\s*Sitemap:\s*(\S+)/im) || [])[1] || null };
  } catch { robotsTxt = { evaluated: true, available: false, sitemap: null }; }
  let sitemap = { evaluated: false, available: null };
  const sitemapUrl = robotsTxt.sitemap || new URL('/sitemap.xml', page).toString();
  try {
    if (new URL(sitemapUrl).origin !== page.origin) { sitemap = { evaluated: false, available: null }; }
    else {
    const sitemapResponse = await (options.fetchTextResource || fetchTextResource)(sitemapUrl, { lookup: options.fetchOptions?.lookup });
    sitemap = { evaluated: true, available: sitemapResponse.status >= 200 && sitemapResponse.status < 300 && /<urlset|<sitemapindex/i.test(sitemapResponse.text) };
    }
  } catch { sitemap = { evaluated: true, available: false }; }
  metrics.robotsTxt = robotsTxt;
  metrics.sitemap = sitemap;
  metrics.https = page.protocol === 'https:';
  const score = calculateScore(metrics, fetched.status);
  const issues = generateRecommendations(metrics, fetched.status);
  return {
    submittedUrl: input, finalUrl: fetched.finalUrl, scannedAt: new Date().toISOString(),
    httpStatus: fetched.status, status: fetched.status >= 200 && fetched.status < 400 ? 'completed' : 'http-error',
    responseTimeMs: fetched.responseTime, metrics, score, scoreBreakdown: score.breakdown,
    issues, recommendations: issues.map(({ priority, title, suggestedFix, issueId }) => ({ priority, title, action: suggestedFix, issueId })),
    limitations: ['Analysis reads the returned HTML and does not execute page JavaScript.', 'Core Web Vitals and Lighthouse performance are not measured.', 'Image destinations are not fetched or tested.'],
    evidence,
  };
}

module.exports = { analyzeWebsite, parseHTML };
