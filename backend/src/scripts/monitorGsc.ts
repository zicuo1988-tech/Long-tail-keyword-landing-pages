/**
 * Weekly GSC monitor entry — npx tsx src/scripts/monitorGsc.ts
 */
import { runGscMonitor } from "../services/searchConsoleMonitor.js";

runGscMonitor()
  .then((result) => {
    console.log("[GSC Monitor]", result);
  })
  .catch((err) => {
    console.error("[GSC Monitor] failed:", err);
    process.exit(1);
  });
