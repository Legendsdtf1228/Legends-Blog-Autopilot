import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().default("gpt-5.6-terra"),
  SHOPIFY_SHOP: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/).optional(),
  SHOPIFY_CLIENT_ID: z.string().min(1).optional(),
  SHOPIFY_CLIENT_SECRET: z.string().min(1).optional(),
  SHOPIFY_API_VERSION: z.string().default("2026-07"),
  STOREFRONT_URL: z.string().url().default("https://legendsdtf.com"),
  ADMIN_USERNAME: z.string().default("admin"),
  ADMIN_PASSWORD: z.string().min(12),
  SESSION_SECRET: z.string().min(16).optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TRUST_PROXY: z.coerce.boolean().default(true)
});

export type AppConfig = z.infer<typeof schema> & {
  OPENAI_API_KEY: string;
  SHOPIFY_SHOP: string;
  SHOPIFY_CLIENT_ID: string;
  SHOPIFY_CLIENT_SECRET: string;
  SESSION_SECRET: string;
};

const databaseSchema = z.object({ DATABASE_URL: z.string().min(1) });

export function loadDatabaseConfig(): z.infer<typeof databaseSchema> {
  const result = databaseSchema.safeParse(process.env);
  if (!result.success) throw new Error(`Invalid database environment: ${result.error.message}`);
  return result.data;
}

export function loadConfig(): AppConfig {
  const result = schema.safeParse(process.env);
  if (!result.success) throw new Error(`Invalid environment: ${result.error.message}`);
  const data = result.data;
  const missing: string[] = [];
  if (!data.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (!data.SHOPIFY_SHOP) missing.push("SHOPIFY_SHOP");
  if (!data.SHOPIFY_CLIENT_ID) missing.push("SHOPIFY_CLIENT_ID");
  if (!data.SHOPIFY_CLIENT_SECRET) missing.push("SHOPIFY_CLIENT_SECRET");
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);

  const sessionSecret = data.SESSION_SECRET || `derived:${data.ADMIN_PASSWORD}:${data.SHOPIFY_CLIENT_SECRET}`;
  return {
    ...data,
    OPENAI_API_KEY: data.OPENAI_API_KEY!,
    SHOPIFY_SHOP: data.SHOPIFY_SHOP!,
    SHOPIFY_CLIENT_ID: data.SHOPIFY_CLIENT_ID!,
    SHOPIFY_CLIENT_SECRET: data.SHOPIFY_CLIENT_SECRET!,
    SESSION_SECRET: sessionSecret
  };
}

export function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/sk-[a-zA-Z0-9_-]{10,}/g, "[REDACTED_OPENAI_KEY]")
      .replace(/shp(at|ss|ua)_[a-zA-Z0-9]+/gi, "[REDACTED_SHOPIFY_TOKEN]")
      .replace(/Bearer\s+[A-Za-z0-9\-_.]+/gi, "Bearer [REDACTED]")
      .replace(/client_secret=[^&\s]+/gi, "client_secret=[REDACTED]");
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (/password|secret|token|authorization|api[_-]?key|cookie/i.test(k)) out[k] = "[REDACTED]";
      else out[k] = redactSecrets(v);
    }
    return out;
  }
  return value;
}
