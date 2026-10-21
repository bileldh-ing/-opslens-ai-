import { runMigrations } from "../src/db/migrate";
import { closeDb } from "../src/db";

runMigrations()
  .then(() => console.log("✓ migrations applied"))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
