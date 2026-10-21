import { closeDb } from "../src/db";
import { runMigrations } from "../src/db/migrate";
import { seedDemo } from "../src/server/demo-seed";

runMigrations()
  .then(() => seedDemo())
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
