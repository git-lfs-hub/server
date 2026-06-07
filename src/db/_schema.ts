import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const locks = sqliteTable('locks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  uuid: text('uuid').notNull().unique(),
  path: text('path').notNull().unique(),
  locked_at: text('locked_at').notNull(),
  owner: text('owner').notNull(),
});
