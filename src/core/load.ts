import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Doc } from "./types";

/** Read every .md/.txt file in a directory into Doc records (id = filename). */
export function loadDocsFromDir(dir: string): Doc[] {
  const docs: Doc[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isFile() && /\.(md|txt|markdown)$/i.test(name)) {
      docs.push({ id: name, source: name, text: readFileSync(full, "utf8") });
    }
  }
  return docs;
}
