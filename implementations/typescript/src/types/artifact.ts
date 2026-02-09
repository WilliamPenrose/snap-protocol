import type { Part } from './part.js';

/** Output produced by a task. Contains one or more parts. */
export interface Artifact {
  artifactId: string;
  name?: string;
  parts: Part[];
  partial?: boolean;
}
