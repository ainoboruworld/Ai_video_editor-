import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);

// Use the browser preinstalled in this environment instead of letting
// Remotion download its own (network egress to remotion.media may be
// blocked in sandboxed/CI environments). Override via BROWSER_EXECUTABLE
// if your machine needs a different path, or unset to let Remotion
// manage its own download where network access allows it.
if (process.env.BROWSER_EXECUTABLE) {
  Config.setBrowserExecutable(process.env.BROWSER_EXECUTABLE);
}
