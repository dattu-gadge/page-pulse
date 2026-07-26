const cheerio = require("cheerio");

function parseHTML(html) {
  const $ = cheerio.load(html);

  const pageTitle = $("title").text();

  const metaDescription =
    $('meta[name="description"]').attr("content") || "Not Found";

  const h1Count = $("h1").length;

  const imagesMissingAlt = $("img").filter(function () {
    return !$(this).attr("alt");
  }).length;

  const wordCount = $("body")
    .text()
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  return {
    pageTitle,
    metaDescription,
    h1Count,
    imagesMissingAlt,
    wordCount,
  };
}

module.exports = parseHTML;