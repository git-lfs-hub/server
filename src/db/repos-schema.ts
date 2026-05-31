import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

export const repos = sqliteTable(
  "repos",
  {
    owner: text("owner").notNull(), // lowercase identity
    repo: text("repo").notNull(), // lowercase identity
    name: text("name").notNull(), // canonical prefix/name, e.g. "Owner/Repo"
    ver: integer("ver").notNull().default(0), // last migration applied (Part B)
  },
  (t) => [primaryKey({ columns: [t.owner, t.repo] })],
);
