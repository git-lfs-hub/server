import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

// High-water mark of repo migrations. Bump in migration.ver.json when adding a
// migration — the deploy trigger reads the same file, so the two never drift.
// New repos are born at this version (nothing to migrate); migration walks
// any repo whose `ver` is below it.
import migrationVer from "./migration.ver.json";
export const CURRENT_VER = migrationVer.current;

export const repos = sqliteTable(
  "repos",
  {
    owner: text("owner").notNull(), // lowercase identity
    repo: text("repo").notNull(), // lowercase identity
    name: text("name").notNull(), // canonical prefix/name, e.g. "Owner/Repo"
    ver: integer("ver").notNull().default(0), // last migration applied
  },
  (t) => [primaryKey({ columns: [t.owner, t.repo] })],
);
