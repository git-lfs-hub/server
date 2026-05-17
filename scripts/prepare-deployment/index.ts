/**
 * Renders deployment artifacts from Handlebars templates (repo root):
 * - wrangler.jsonc ← wrangler.template.jsonc
 * - github-app.md ← github-app.template.md
 * Context is read from ./vars.json.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Handlebars from "handlebars";

const cwd = process.cwd();

const varsPath = resolve(cwd, "vars.json");
let vars = JSON.parse(readFileSync(varsPath, "utf8"));

const compile = (source: string) =>
  Handlebars.compile(source, { strict: true, noEscape: true });

const render = (templateRel: string, outRel: string) => {
  const templatePath = resolve(cwd, templateRel);
  const outPath = resolve(cwd, outRel);
  const templateSource = readFileSync(templatePath, "utf8");
  let output = compile(templateSource)(vars);
  writeFileSync(outPath, output, "utf8");
  console.log(`Wrote ${outPath}`);
};

render("wrangler.template.jsonc", "wrangler.jsonc");
render("github-app.template.md", "github-app.md");
