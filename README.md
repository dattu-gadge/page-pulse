# Page Pulse

Page Pulse is a web application that audits any website URL and returns basic SEO information.

## Features

- HTTP Status
- Response Time
- Page Title
- Meta Description
- H1 Count
- Images Missing Alt Text
- Word Count

## Technologies Used

- Node.js
- Express.js
- Axios
- Cheerio
- Jest

## Installation

```bash
npm install
```

## Run the Server

```bash
npm start
```

Server runs on:

```
http://localhost:5000
```

## Run Tests

```bash
npm test
```

## API

### POST /analyze

Request:

```json
{
  "url": "https://example.com"
}
```

Response:

```json
{
  "status": 200,
  "responseTime": 120,
  "pageTitle": "Example Domain",
  "metaDescription": "...",
  "h1Count": 1,
  "imagesMissingAlt": 0,
  "wordCount": 250
}
```

## Design Decisions

1. Used Axios for fast HTTP requests.
2. Used Cheerio to parse HTML efficiently.
3. Used Jest to test the HTML parsing logic.

## AI Usage

I used ChatGPT to understand the project requirements, improve the parser implementation, write unit tests, and prepare the README. I reviewed, modified, and tested the generated code before submitting.