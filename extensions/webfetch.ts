import type { TextContent, ImageContent } from "@earendil-works/pi-ai";
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
import TurndownService from "turndown";
import { Type } from "typebox";

/**
 * Extracts and concatenates all text-type content blocks from a fetch result.
 * @param result - The fetch result containing content blocks.
 * @param _showImages - Unused; reserved for future image rendering support.
 * @returns The concatenated text content, or empty string if none found.
 */
function getTextOutput(
  result: AgentToolResult<FetchDetails> | undefined,
  _showImages: boolean,
): string {
  return (
    result?.content
      .filter((c): c is TextContent => c.type === "text")
      .map((c) => c.text)
      .join("\n") || ""
  );
}

const fetchParams = Type.Object({
  url: Type.String({
    format: "uri",
    description: "The URL of the web page to fetch.",
  }),
});

type FetchInput = {
  url: string;
};

type WebfetchRenderState = {
  startedAt: number | undefined;
  endedAt: number | undefined;
  interval: NodeJS.Timeout | undefined;
};

type WebfetchResultRenderState = {
  cachedWidth: number | undefined;
  cachedLines: string[] | undefined;
  cachedSkipped: number | undefined;
};

class WebfetchResultRenderComponent extends Container {
  state: WebfetchResultRenderState = {
    cachedWidth: undefined,
    cachedLines: undefined,
    cachedSkipped: undefined,
  };
}

/**
 * Details about a webfetch result, including optional truncation metadata.
 */
interface FetchDetails {
  /** Truncation info if the content was trimmed. */
  truncation?: TruncationResult | undefined;
}

const WEBFETCH_PREVIEW_LINES = 15;

/**
 * Formats the "call" display text shown when webfetch is executing.
 * @param args - The tool call arguments, containing the URL.
 * @param theme - The current theme for styling.
 * @returns A styled string like "fetch <url>".
 */
function formatWebfetchCall(args: { url: string } | undefined, theme: Theme): string {
  const url = args?.url;
  const urlDisplay = url ? theme.fg("accent", url) : theme.fg("toolOutput", "...");
  return theme.fg("toolTitle", theme.bold(`fetch ${urlDisplay}`));
}

/**
 * Rebuilds the visual rendering component for a webfetch result.
 * Truncates output to a preview when collapsed, and shows a truncation
 * warning banner if the response was trimmed.
 * @param component - The container to populate with output text and hints.
 * @param result - The fetch result with content and optional truncation details.
 * @param options - Rendering options (e.g., whether expanded).
 * @param theme - The current theme for styling.
 * @param showImages - Whether to render image content (currently unused).
 */
function rebuildWebfetchResultRenderComponent(
  component: WebfetchResultRenderComponent,
  result: AgentToolResult<FetchDetails>,
  options: ToolRenderResultOptions,
  theme: Theme,
  showImages: boolean,
  startedAt: number | undefined,
  endedAt: number | undefined,
): void {
  const state = component.state;
  component.clear();

  const output = getTextOutput(result, showImages).trim();

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
            const preview = truncateToVisualLines(styledOutput, WEBFETCH_PREVIEW_LINES, width);
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

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Fetches a URL, converts HTML to markdown, and truncates the result.
 * Only HTTP and HTTPS protocols are supported. Responses over 5 MB are rejected.
 * Text content is truncated; image content is returned as base64.
 * @param params - The fetch input containing the URL.
 * @param signal - Optional abort signal for canceling the request.
 * @returns A promise resolving to the fetched content and optional truncation metadata.
 * @throws Error if the protocol is unsupported, the fetch fails, or the response exceeds 5 MB.
 */
const webfetch = async (
  { url: urlStr }: FetchInput,
  signal?: AbortSignal,
): Promise<{
  content: (TextContent | ImageContent)[];
  truncation: TruncationResult | undefined;
}> => {
  const url = new URL(urlStr);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS protocols are supported.");
  }

  const response = await fetch(url, { signal: signal ?? null });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url.href}: ${response.statusText}`);
  }

  const contentType = ((response.headers.get("content-type") || "").split(";")[0] ?? "")
    .trim()
    .toLowerCase();
  const arrayBuffer = await response.arrayBuffer();

  // Parse the media type (RFC 9110: media-type = type "/" subtype)
  const mediaType = contentType.split("/")[0] ?? "";

  if (mediaType === "image") {
    // Return image as base64-encoded ImageContent
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return {
      content: [{ type: "image", data: base64, mimeType: contentType }],
      truncation: undefined,
    };
  }

  // For text content (including text/html), decode and optionally convert
  let textContent = new TextDecoder().decode(arrayBuffer);
  if (contentType === "text/html") {
    textContent = turndownService.turndown(textContent);
  }

  // Apply truncation using defaults (2000 lines / 50KB)
  const truncation = truncateHead(textContent);
  return {
    content: [{ type: "text", text: truncation.content }],
    truncation: truncation.truncated ? truncation : undefined,
  };
};

const turndownService = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

/**
 * Extension entry point. Registers the `webfetch` tool with the pi agent,
 * providing web page fetching, HTML-to-markdown conversion, and result truncation.
 * @param pi - The pi extension API for registering tools.
 */
export default async function (pi: ExtensionAPI) {
  pi.registerTool(
    defineTool<typeof fetchParams, FetchDetails, WebfetchRenderState>({
      name: "webfetch",
      label: "webfetch",
      description:
        `Fetch information from the web, such as reading articles, accessing documentation, or gathering data from online sources. Use when user or instructions contain a URL that may provide more context/relevant information. ` +
        `HTML content will be converted to markdown format for easier reading and processing. ` +
        `Results are truncated to first ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} (whichever is hit first) to prevent large responses from overwhelming the context window.`,
      promptSnippet: "Fetch web pages and convert HTML to markdown with truncation",
      parameters: fetchParams,
      execute: async (
        _toolCallId,
        params: FetchInput,
        signal,
        _onUpdate,
        _ctx,
      ): Promise<AgentToolResult<FetchDetails>> => {
        try {
          const { content, truncation } = await webfetch(params, signal);

          const truncationResult: FetchDetails = truncation
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
      }, //,
      renderCall(args, _theme, context) {
        const state = context.state;
        if (context.executionStarted && state.startedAt === undefined) {
          state.startedAt = Date.now();
          state.endedAt = undefined;
        }
        const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
        text.setText(formatWebfetchCall(args, _theme));
        return text;
      },
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
          (context.lastComponent as WebfetchResultRenderComponent | undefined) ??
          new WebfetchResultRenderComponent();
        rebuildWebfetchResultRenderComponent(
          component,
          result,
          options,
          _theme,
          context.showImages,
          state.startedAt,
          state.endedAt,
        );
        component.invalidate();
        return component;
      },
    }),
  );
}
