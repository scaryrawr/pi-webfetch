# pi-webfetch

A [pi](https://github.com/mariozechner/pi-coding-agent) extension that adds a `webfetch` tool — fetches web pages, converts HTML to markdown, and truncates oversized responses.

## What it does

When pi (the AI coding agent) needs to read a web page, it can call the `webfetch` tool with a URL. The extension:

1. Fetches the page (only `http:` and `https:` protocols are supported).
2. Converts HTML responses to clean markdown using [Turndown](https://github.com/mixmark-io/turndown) (ATX headings, fenced code blocks, `-` list markers).
3. Truncates the result to **2000 lines or 50 KB** (whichever is hit first) to protect the context window.
4. Returns the content as text with optional truncation metadata.

Responses over **5 MB** are rejected at the fetch level. The tool also supports abort signals for cancellations.

## Installation

Install the extension using pi's built-in install command:

```bash
pi install git:github.com/scaryrawr/pi-webfetch
```

## Configuration

No configuration is required — the extension works out of the box with default truncation limits.

## License

MIT
