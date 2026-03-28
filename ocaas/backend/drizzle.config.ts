import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  // Point directly to schema files to avoid .js extension resolution issues
  schema: './src/db/schema/*.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL || './data/ocaas.db',
  },
});
