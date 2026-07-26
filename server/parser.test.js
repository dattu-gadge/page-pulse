const parseHTML = require("./parser");

describe("parseHTML", () => {
  test("should extract SEO information", () => {
    const html = `
      <html>
        <head>
          <title>Test Website</title>
          <meta name="description" content="This is a test website">
        </head>
        <body>
          <h1>Welcome</h1>
          <img src="a.jpg" alt="Image 1">
          <img src="b.jpg">
          <p>Hello world from Digital Heroes</p>
        </body>
      </html>
    `;

    const result = parseHTML(html);

    expect(result.pageTitle).toBe("Test Website");
    expect(result.metaDescription).toBe("This is a test website");
    expect(result.h1Count).toBe(1);
    expect(result.imagesMissingAlt).toBe(1);
    expect(result.wordCount).toBeGreaterThan(0);
  });
});