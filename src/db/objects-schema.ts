import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const locks = sqliteTable('locks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  uuid: text('uuid').notNull().unique(),
  path: text('path').notNull().unique(),
  locked_at: text('locked_at').notNull(),
  owner: text('owner').notNull(),
});

// Per-object soft-delete, scoped to this DO's prefix (the DO instance == prefix,
// so no prefix column). A present row → that OID serves 404.
export const blocked = sqliteTable('blocked', {
  oid: text('oid').primaryKey(),
});
