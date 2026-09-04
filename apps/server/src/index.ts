import { loadLocalEnv } from "./config/env.js";
import { loadConfig } from "./config/config.js";
import { openDatabase } from "./db/database.js";
import { buildApp } from "./http/app.js";

const rootDir = loadLocalEnv();

const config = await loadConfig(process.env, rootDir);
const db = openDatabase(config.configDir);
const app = await buildApp({ config, db });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
