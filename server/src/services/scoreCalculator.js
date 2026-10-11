const WEIGHTS = { availability: 20, metadata: 22, headings: 16, images: 14, links: 10, accessibility: 10, discovery: 8 };

function calculateScore(metrics, httpStatus) {
  const groups = {
    availability: httpStatus >= 200 && httpStatus < 400 && metrics.https ? 100 : httpStatus >= 200 && httpStatus < 400 ? 70 : 0,
    metadata: [metrics.title.status, metrics.description.status].reduce((sum, status) => sum + (status === 'pass' ? 100 : status === 'warning' ? 65 : 0), 0) / 2,
    headings: metrics.headings.h1Count === 1 ? (metrics.headings.skippedLevels ? 70 : 100) : metrics.headings.h1Count === 0 ? 0 : 70,
    images: metrics.images.total === 0 ? null : Math.max(0, 100 - (metrics.images.missingAlt + metrics.images.emptyAlt) / metrics.images.total * 100),
    links: metrics.links.missingDestination === 0 ? 100 : Math.max(0, 100 - Math.min(100, metrics.links.missingDestination * 20)),
    accessibility: [metrics.language ? 100 : 0, metrics.viewport ? 100 : 0].reduce((a, b) => a + b, 0) / 2,
    discovery: metrics.indexability.blockedByMeta ? 0 : metrics.canonical ? 100 : 70,
  };
  let points = 0; let possible = 0;
  const breakdown = Object.entries(WEIGHTS).map(([category, weight]) => {
    const value = groups[category];
    if (value == null) return { category, weight, score: null, points: null, status: 'not-evaluated' };
    possible += weight; points += weight * value / 100;
    return { category, weight, score: Math.round(value), points: Math.round(weight * value / 100), status: value >= 85 ? 'pass' : value >= 60 ? 'warning' : 'fail' };
  });
  return { value: possible ? Math.round(points / possible * 100) : 0, outOf: 100, formula: 'Weighted points earned divided by the weights evaluated. Unevaluable image checks are excluded and weights are normalized.', breakdown };
}

module.exports = { WEIGHTS, calculateScore };
