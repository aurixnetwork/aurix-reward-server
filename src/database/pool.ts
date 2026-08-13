import mysql, { type Pool } from "mysql2/promise";

import type { DatabaseConfig } from "../config/environment.js";

export function createDatabasePool(config: DatabaseConfig): Pool {
  return mysql.createPool({
    charset: "utf8mb4",
    connectionLimit: config.connectionLimit,
    database: config.database,
    decimalNumbers: false,
    enableKeepAlive: true,
    host: config.host,
    namedPlaceholders: true,
    password: config.password,
    port: config.port,
    supportBigNumbers: true,
    timezone: "Z",
    user: config.user,
  });
}
