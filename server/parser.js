const { parseHTML } = require('./src/services/seoAnalyzer');

function legacyParseHTML(html) {
  const { metrics } = parseHTML(html);
  return {
    pageTitle: metrics.title.text,
    metaDescription: metrics.description.present ? metrics.description.text : 'Not Found',
    h1Count: metrics.headings.h1Count,
    imagesMissingAlt: metrics.images.missingAlt,
    wordCount: metrics.visibleWordCount,
  };
}

module.exports = legacyParseHTML;
