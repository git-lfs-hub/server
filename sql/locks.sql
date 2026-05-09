CREATE TABLE IF NOT EXISTS locks (
  id         TEXT PRIMARY KEY NOT NULL,
  owner      TEXT NOT NULL,
  path       TEXT NOT NULL,
  repo       TEXT NOT NULL,
  locked_at  TEXT NOT NULL,
  UNIQUE (repo, path)
);
