import { loadDatabaseConfig } from "./config.js";
import { createDb, migrate } from "./db.js";

const config = loadDatabaseConfig();
const db = createDb(config.DATABASE_URL);
await migrate(db);
await db.end();
console.log("Database is ready.");
