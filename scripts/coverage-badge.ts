#!/usr/bin/env bun
import summary from "../coverage/coverage-summary.json" with { type: "json" };

const pct = summary.total.statements.pct as number;
const color =
  pct >= 80 ? "green" : pct >= 60 ? "yellow" : pct >= 40 ? "orange" : "red";

await Bun.write(
  new URL("../coverage/coverage-badge.json", import.meta.url),
  JSON.stringify({ subject: "Coverage", status: `${pct}%`, color }),
);
