#!/usr/bin/env node
/** Initialize the configured persistence backend and print PHI-free status. */
import { closeDatabase, initializeDatabase } from "../lib/storage/db";

try {
  const info = await initializeDatabase();
  console.log(JSON.stringify({
    status: "initialized",
    backend: info.backend,
    schema_version: info.database_schema_version,
    migration_version: info.migration_version,
    database_file: "<configured-database>",
  }, null, 2));
} finally {
  await closeDatabase();
}
