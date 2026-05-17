/**
 * Renders deployment artifacts from Handlebars templates (repo root):
 * - wrangler.jsonc ← wrangler.template.jsonc
 * - github-app.md ← github-app.template.md
 * Context is read from ./vars.json.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildVars, renderTemplate } from "./lib";

const cwd = process.cwd();

const vars = buildVars(JSON.parse(readFileSync(resolve(cwd, "vars.json"), "utf8")));

const render = (templateRel: string, outRel: string) => {
  const output = renderTemplate(readFileSync(resolve(cwd, templateRel), "utf8"), vars);
  writeFileSync(resolve(cwd, outRel), output, "utf8");
  console.log(`Wrote ${resolve(cwd, outRel)}`);
};

render("wrangler.template.jsonc", "wrangler.jsonc");
render("github-app.template.md", "github-app.md");
