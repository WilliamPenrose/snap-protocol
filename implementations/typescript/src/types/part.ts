/** Media type string (e.g. "text/plain", "application/json"). */
export type MediaType = string;

/** Part containing plain text or code content. */
export interface TextPart {
  text: string;
  mediaType?: MediaType;
}

/** Part containing base64-encoded binary content. */
export interface RawPart {
  raw: string;
  mediaType: MediaType;
}

/** Part referencing external content via URL. */
export interface UrlPart {
  url: string;
  mediaType?: MediaType;
}

/** Part containing structured JSON data. */
export interface DataPart {
  data: Record<string, unknown>;
  mediaType?: MediaType;
}

/** Content unit within messages and artifacts. Exactly one of text, raw, url, or data. */
export type Part = TextPart | RawPart | UrlPart | DataPart;
