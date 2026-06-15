import { execFile, exec } from "node:child_process";

import type { TextContent } from "@earendil-works/pi-ai";
import {
  type ExtensionAPI,
  defineTool,
  truncateHead,
  type TruncationResult,
  type AgentToolResult,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  keyHint,
  truncateToVisualLines,
  type ToolRenderResultOptions,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Container, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

/**
 * Checks whether an executable command is available on the current PATH.
 * @param cmd - The command name to look up.
 * @returns A promise resolving to true when the command exists.
 */
export function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const checker = process.platform === "win32" ? `where ${cmd}` : `command -v ${cmd}`;

    exec(checker, (err) => {
      resolve(!err);
    });
  });
}

/**
 * Extracts and concatenates all text-type content blocks from a search result.
 * @param result - The search result containing content blocks.
 * @returns The concatenated text content, or empty string if none found.
 */
function getTextOutput(result: AgentToolResult<SearchDetails> | undefined): string {
  return (
    result?.content
      .filter((c): c is TextContent => c.type === "text")
      .map((c) => c.text)
      .join("\n") || ""
  );
}

/** Schema for the websearch tool parameters. */
const searchParams = Type.Object({
  query: Type.String({
    description: "The search query to find information on the web.",
  }),
});

/** Input accepted by the websearch tool executor. */
type SearchInput = Static<typeof searchParams>;

/** Runtime state preserved across websearch call/result renders. */
type WebsearchRenderState = {
  /** Timestamp when execution started, in milliseconds since epoch. */
  startedAt: number | undefined;
  /** Timestamp when execution ended, in milliseconds since epoch. */
  endedAt: number | undefined;
  /** Timer used to invalidate elapsed-time rendering while a search is running. */
  interval: NodeJS.Timeout | undefined;
};

/** Cached layout state for collapsed websearch result rendering. */
type WebsearchResultRenderState = {
  /** Width used to compute the cached preview lines. */
  cachedWidth: number | undefined;
  /** Cached preview visual lines for the current width. */
  cachedLines: string[] | undefined;
  /** Number of visual lines omitted from the collapsed preview. */
  cachedSkipped: number | undefined;
};

/** Container component used to render cached websearch result previews. */
class WebsearchResultRenderComponent extends Container {
  state: WebsearchResultRenderState = {
    cachedWidth: undefined,
    cachedLines: undefined,
    cachedSkipped: undefined,
  };
}

/**
 * Details about a websearch result, including optional truncation metadata.
 */
interface SearchDetails {
  /** Truncation info if the content was trimmed. */
  truncation?: TruncationResult | undefined;
}

const WEBSEARCH_PREVIEW_LINES = 15;

/**
 * Formats the "call" display text shown when websearch is executing.
 * @param args - The tool call arguments, containing the query.
 * @param theme - The current theme for styling.
 * @returns A styled string like "search <query>".
 */
function formatWebsearchCall(args: { query: string } | undefined, theme: Theme): string {
  const query = args?.query;
  const queryDisplay = query ? theme.fg("accent", query) : theme.fg("toolOutput", "...");
  return theme.fg("toolTitle", theme.bold(`search ${queryDisplay}`));
}

/**
 * Rebuilds the visual rendering component for a websearch result.
 * Truncates output to a preview when collapsed, and shows a truncation
 * warning banner if the response was trimmed.
 * @param component - The container to populate with output text and hints.
 * @param result - The search result with content and optional truncation details.
 * @param options - Rendering options (e.g., whether expanded).
 * @param theme - The current theme for styling.
 * @param startedAt - Timestamp when the search started, if known.
 * @param endedAt - Timestamp when the search finished, if known.
 */
function rebuildWebsearchResultRenderComponent(
  component: WebsearchResultRenderComponent,
  result: AgentToolResult<SearchDetails>,
  options: ToolRenderResultOptions,
  theme: Theme,
  startedAt: number | undefined,
  endedAt: number | undefined,
): void {
  const state = component.state;
  component.clear();

  const output = getTextOutput(result).trim();

  if (output) {
    const styledOutput = output
      .split("\n")
      .map((line: string) => theme.fg("toolOutput", line))
      .join("\n");

    if (options.expanded) {
      component.addChild(new Text(`\n${styledOutput}`, 0, 0));
    } else {
      component.addChild({
        render: (width: number) => {
          if (state.cachedLines === undefined || state.cachedWidth !== width) {
            const preview = truncateToVisualLines(styledOutput, WEBSEARCH_PREVIEW_LINES, width);
            state.cachedLines = preview.visualLines;
            state.cachedSkipped = preview.skippedCount;
            state.cachedWidth = width;
          }
          if (state.cachedSkipped && state.cachedSkipped > 0) {
            const hint =
              theme.fg("muted", `... (${state.cachedSkipped} more lines,`) +
              ` ${keyHint("app.tools.expand", "to expand")})`;
            return ["", truncateToWidth(hint, width, "..."), ...(state.cachedLines ?? [])];
          }
          return ["", ...(state.cachedLines ?? [])];
        },
        invalidate: () => {
          state.cachedWidth = undefined;
          state.cachedLines = undefined;
          state.cachedSkipped = undefined;
        },
      });
    }
  }

  const truncation = result.details?.truncation;
  if (truncation?.truncated) {
    const warnings: string[] = [];
    if (truncation.truncatedBy === "lines") {
      warnings.push(
        `Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`,
      );
    } else {
      warnings.push(
        `Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)`,
      );
    }
    component.addChild(new Text(`\n${theme.fg("warning", `[${warnings.join(". ")}]`)}`, 0, 0));
  }

  if (startedAt !== undefined) {
    const label = options.isPartial ? "Elapsed" : "Took";
    const endTime = endedAt ?? Date.now();
    component.addChild(
      new Text(`\n${theme.fg("muted", `${label} ${formatDuration(endTime - startedAt)}`)}`, 0, 0),
    );
  }
}

/**
 * Formats a duration in milliseconds for compact TUI display.
 * @param ms - Duration in milliseconds.
 * @returns The duration formatted in seconds with one decimal place.
 */
function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Parsed fields for a single DuckDuckGo Lite search result. */
interface ParsedSearchResult {
  /** One-based result number shown to the agent. */
  resultNumber: number;
  /** Human-readable result title. */
  title: string;
  /** Direct destination URL, with DuckDuckGo redirects decoded when possible. */
  url: string;
  /** Search-result summary text. */
  snippet: string;
}

/** HTML entity names commonly emitted by DuckDuckGo Lite result markup. */
const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  copy: "©",
  gt: ">",
  hellip: "…",
  laquo: "«",
  ldquo: "“",
  lsaquo: "‹",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  raquo: "»",
  rdquo: "”",
  reg: "®",
  rsaquo: "›",
  rsquo: "’",
  shy: "",
  trade: "™",
};

/**
 * Decodes named and numeric HTML entities in a string.
 * @param value - Text that may contain HTML entities.
 * @returns The text with supported entities decoded.
 */
function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]+);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return codePointToString(codePoint) ?? match;
    }
    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return codePointToString(codePoint) ?? match;
    }
    return HTML_ENTITIES[normalized] ?? match;
  });
}

/**
 * Converts a Unicode code point to a string without throwing on invalid input.
 * @param codePoint - The numeric Unicode code point.
 * @returns The corresponding string, or undefined if invalid.
 */
function codePointToString(codePoint: number): string | undefined {
  if (!Number.isFinite(codePoint)) {
    return undefined;
  }
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return undefined;
  }
}

/**
 * Converts a small HTML fragment into compact plaintext.
 * @param html - HTML fragment to strip and decode.
 * @returns Plaintext with tags removed and whitespace collapsed.
 */
function htmlToPlainText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/(?:div|p|td|tr|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reads an attribute value from a raw HTML attribute string.
 * @param attributes - Raw attributes from an opening HTML tag.
 * @param name - Attribute name to read.
 * @returns The decoded attribute value, or an empty string when absent.
 */
function getHtmlAttribute(attributes: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attrRe = new RegExp(`\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const match = attributes.match(attrRe);
  return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

/**
 * Checks whether an HTML attribute string includes a CSS class.
 * @param attributes - Raw attributes from an opening HTML tag.
 * @param className - CSS class name to look for.
 * @returns True when the class attribute contains the requested class.
 */
function hasHtmlClass(attributes: string, className: string): boolean {
  return getHtmlAttribute(attributes, "class").split(/\s+/).includes(className);
}

/**
 * Extracts plaintext from the first matching element with a CSS class.
 * @param html - HTML segment to search.
 * @param tagName - Element tag name to match.
 * @param className - CSS class name that must be present.
 * @returns The element plaintext, or an empty string when no match is found.
 */
function extractFirstElementTextByClass(html: string, tagName: string, className: string): string {
  const elementRe = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  for (const match of html.matchAll(elementRe)) {
    const attributes = match[1] ?? "";
    if (hasHtmlClass(attributes, className)) {
      return htmlToPlainText(match[2] ?? "");
    }
  }
  return "";
}

/**
 * Decodes DuckDuckGo Lite result redirect URLs into direct destination URLs.
 * @param href - Result link href, usually a DuckDuckGo `/l/?uddg=...` URL.
 * @returns The decoded destination URL, or the original URL if decoding fails.
 */
function decodeDuckDuckGoResultUrl(href: string): string {
  if (!href) {
    return "";
  }

  try {
    const url = new URL(href, "https://duckduckgo.com");
    return url.searchParams.get("uddg") || url.href;
  } catch {
    return href;
  }
}

/**
 * Converts a displayed result URL into an absolute HTTPS URL fallback.
 * @param displayUrl - DuckDuckGo Lite display URL text.
 * @returns An absolute URL string, or an empty string when no display URL exists.
 */
function displayUrlToHref(displayUrl: string): string {
  if (!displayUrl) {
    return "";
  }
  if (/^https?:\/\//i.test(displayUrl)) {
    return displayUrl;
  }
  return `https://${displayUrl}`;
}

/**
 * Parses DuckDuckGo Lite HTML into structured search result records.
 * @param html - Raw DuckDuckGo Lite HTML.
 * @returns Parsed result records in page order.
 */
function parseSearchResultsFromHtml(html: string): ParsedSearchResult[] {
  const linkRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const links = [...html.matchAll(linkRe)].filter((match) =>
    hasHtmlClass(match[1] ?? "", "result-link"),
  );
  const results: ParsedSearchResult[] = [];

  for (let index = 0; index < links.length; index++) {
    const link = links[index];
    if (link?.index === undefined) {
      continue;
    }

    const attributes = link[1] ?? "";
    const title = htmlToPlainText(link[2] ?? "");
    const href = decodeDuckDuckGoResultUrl(getHtmlAttribute(attributes, "href"));
    const segmentStart = link.index + link[0].length;
    const segmentEnd = links[index + 1]?.index ?? html.length;
    const segment = html.slice(segmentStart, segmentEnd);
    const snippet = extractFirstElementTextByClass(segment, "td", "result-snippet");
    const displayUrl = extractFirstElementTextByClass(segment, "span", "link-text");
    const url = href || displayUrlToHref(displayUrl);

    if (title || url || snippet) {
      results.push({ resultNumber: results.length + 1, title, url, snippet });
    }
  }

  return results;
}

/**
 * Formats parsed search results into an LLM-friendly plaintext report.
 * @param results - Parsed result records to format.
 * @param query - Original search query, if available.
 * @returns Plaintext search output with explicit title, URL, and snippet labels.
 */
function formatSearchResults(results: ParsedSearchResult[], query: string | undefined): string {
  const header: string[] = [];
  if (query) {
    header.push(`Search query: ${query}`);
  }
  header.push("Search provider: DuckDuckGo Lite", `Results: ${results.length}`);

  if (results.length === 0) {
    return `${header.join("\n")}\n\nNo results found.`;
  }

  const entries = results.map((result) =>
    [
      `${result.resultNumber}. Title: ${result.title || "(no title)"}`,
      `   URL: ${result.url || "(no URL found)"}`,
      `   Snippet: ${result.snippet || "(no snippet)"}`,
    ].join("\n"),
  );

  return `${header.join("\n")}\n\n${entries.join("\n\n")}`;
}

/**
 * Reformats DuckDuckGo Lite HTML into clean, agent-friendly result entries
 * with explicit `Title`, `URL`, and `Snippet` labels.
 *
 * DuckDuckGo Lite marks organic results with stable classes (`result-link`,
 * `result-snippet`, and `link-text`). Parsing those fields directly avoids
 * the form/filter noise and markdown artifacts produced by generic HTML to
 * markdown conversion.
 * @param html - The raw DuckDuckGo Lite HTML from `lynx -source`.
 * @param query - The search query to include in the result header.
 * @returns The reformatted results.
 */
export function cleanSearchOutput(html: string, query?: string): string {
  return formatSearchResults(parseSearchResultsFromHtml(html), query);
}

/**
 * Runs a web search via `lynx -source` against DuckDuckGo Lite.
 * The HTML is parsed for DuckDuckGo Lite's result fields and reformatted into
 * clean result entries before truncation.
 * @param params - The search input containing the query.
 * @param signal - Optional abort signal for canceling the search.
 * @returns A promise resolving to the search output and optional truncation metadata.
 * @throws Error if lynx fails to run.
 */
const websearch = async (
  { query }: SearchInput,
  signal?: AbortSignal,
): Promise<{
  content: TextContent[];
  truncation: TruncationResult | undefined;
}> => {
  const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      "lynx",
      ["-source", searchUrl],
      { signal: signal ?? undefined, maxBuffer: 5 * 1024 * 1024 },
      (err, out) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(out);
      },
    );
    void child;
  });

  // Apply truncation using defaults (2000 lines / 50KB)
  const truncation = truncateHead(cleanSearchOutput(stdout, query));
  return {
    content: [{ type: "text", text: truncation.content }],
    truncation: truncation.truncated ? truncation : undefined,
  };
};

/**
 * Extension entry point. Registers the `websearch` tool when lynx is available.
 * @param pi - The pi extension API for registering tools.
 */
export default async function (pi: ExtensionAPI) {
  // lynx makes DuckDuckGo Lite scraping more reliable than Node's default fetch.
  if (!(await commandExists("lynx"))) {
    return;
  }

  pi.registerTool(
    defineTool<typeof searchParams, SearchDetails, WebsearchRenderState>({
      name: "websearch",
      label: "Web Search",
      description:
        `Search the web for information. Use this tool to find up-to-date information on the web. Provide a search query. ` +
        `Results are returned as plaintext and truncated to first ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} (whichever is hit first) to prevent large responses from overwhelming the context window.`,
      promptSnippet: "Search the web for recent information on a given query.",
      parameters: searchParams,
      /** Executes the websearch tool and converts thrown errors into tool output. */
      execute: async (
        _toolCallId,
        params: SearchInput,
        signal,
        _onUpdate,
        _ctx,
      ): Promise<AgentToolResult<SearchDetails>> => {
        try {
          const { content, truncation } = await websearch(params, signal);

          const truncationResult: SearchDetails = truncation
            ? { truncation }
            : { truncation: undefined };

          // For text content, append truncation metadata to the last text block
          const finalContent = content.map((c, i) => {
            if (c.type === "text" && i === content.length - 1 && truncation) {
              return {
                ...c,
                text: `${c.text}\n\n[Showing lines ${truncation.totalLines - truncation.outputLines + 1}-${truncation.totalLines} of ${truncation.totalLines} (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Truncated from head.]`,
              };
            }
            return c;
          });

          return {
            content: finalContent,
            details: truncationResult,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `Error: ${message}` }],
            details: { truncation: undefined },
          };
        }
      },
      /** Renders the active websearch tool call in the TUI. */
      renderCall(args, _theme, context) {
        const state = context.state;
        if (context.executionStarted && state.startedAt === undefined) {
          state.startedAt = Date.now();
          state.endedAt = undefined;
        }
        const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
        text.setText(formatWebsearchCall(args, _theme));
        return text;
      },
      /** Renders the websearch result body, preview, truncation notice, and timing. */
      renderResult(result, options, _theme, context) {
        const state = context.state;
        if (state.startedAt !== undefined && options.isPartial && !state.interval) {
          state.interval = setInterval(() => context.invalidate(), 1000);
        }
        if (!options.isPartial || context.isError) {
          state.endedAt ??= Date.now();
          if (state.interval) {
            clearInterval(state.interval);
            state.interval = undefined;
          }
        }
        const component =
          (context.lastComponent as WebsearchResultRenderComponent | undefined) ??
          new WebsearchResultRenderComponent();
        rebuildWebsearchResultRenderComponent(
          component,
          result,
          options,
          _theme,
          state.startedAt,
          state.endedAt,
        );
        component.invalidate();
        return component;
      },
    }),
  );
}
