import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-5.6-terra"),
  SHOPIFY_SHOP: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/),
  SHOPIFY_CLIENT_ID: z.string().min(1),
  SHOPIFY_CLIENT_SECRET: z.string().min(1),
  SHOPIFY_API_VERSION: z.string().default("2026-07"),
  STOREFRONT_URL: z.string().url().default("https://legendsdtf.com"),
  ADMIN_PASSWORD: z.string().min(12),
  APP_URL: z.string().url().default("http://localhost:3000"),
  PORT: z.coerce.number().int().positive().default(3000)
});

export type AppConfig = z.infer<typeof schema>;
const databaseSchema = z.object({ DATABASE_URL: z.string().min(1) });

export function loadConfig(): AppConfig {
  const result = schema.safeParse(process.env);
  if (!result.success) throw new Error(`Invalid environment: ${result.error.message}`);
  return result.data;
}

export function loadDatabaseConfig(): z.infer<typeof databaseSchema> {
  const result = databaseSchema.safeParse(process.env);
  if (!result.success) throw new Error(`Invalid database environment: ${result.error.message}`);
  return result.data;
}
