import path from "node:path";
import { startVitest } from "vitest/node";

const filters = process.argv.slice(2);
const vitest = await startVitest("test", filters, {
  config: false,
  root: process.cwd(),
  run: true,
  passWithNoTests: false,
  reporters: ["dot"],
  include: ["tests/unit/**/*.test.ts"],
  environment: "node",
  alias: { "@": path.resolve("src") },
  // Aislar por archivo: sin esto los mocks (@/lib/ai, baileys/manager) se
  // filtran entre archivos y rompen los tests del sandbox del Laboratorio.
  pool: "forks",
  isolate: true,
});

if (!vitest) process.exit(1);
const failed = vitest.state
  .getFiles()
  .some((file) => file.result?.state === "fail");
await vitest.close();
process.exitCode = failed ? 1 : 0;
