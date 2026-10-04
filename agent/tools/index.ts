import path from "node:path";
import { ToolRegistry } from "./registry";
import { BrowserManager } from "./browser/manager";
import { browserTools } from "./browser/tools";
import { computerTools } from "./computer/tools";
import { appTools } from "./applications/tools";
import { fileTools } from "./files/tools";
import { shellTools } from "./shell/tools";

export function createToolkit(dataDir: string) {
  const browser = new BrowserManager(process.env.ARU_BROWSER_PROFILE || path.join(dataDir, "browser-profile"));
  const registry = new ToolRegistry().register(
    ...browserTools(browser, dataDir), ...computerTools(dataDir), ...appTools(), ...fileTools(), ...shellTools(),
  );
  return { registry, browser };
}
