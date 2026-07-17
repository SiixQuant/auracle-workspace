import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/**
 * Reads the launcher-provisioned canonical Workspace path from the same
 * handshake config the engine bridge uses (`~/.config/auracle/auracle.json`).
 * The launcher is the SINGLE writer of that file; the IDE only ever reads it.
 * Alongside `{engine_url, api_key}` the launcher may add a `workspace_path`
 * naming the Workspace to open on first launch (see AuracleEngineHandlers
 * `readConfig` for the sibling engine_url/api_key reader -- this mirrors its
 * parse without touching that path).
 */
const CONFIG_PATH = join(homedir(), '.config', 'auracle', 'auracle.json');

/**
 * Pure parse of the provisioning config's raw text. Returns the trimmed
 * `workspace_path`, or null when the key is absent (older launcher), empty, not
 * a string, or the JSON is corrupt.
 */
export function parseWorkspacePathFromConfig(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { workspace_path?: unknown };
    if (typeof parsed.workspace_path !== 'string') {
      return null;
    }
    const trimmed = parsed.workspace_path.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the provisioned Workspace path, or null when the config file is
 * missing/unreadable/corrupt or omits `workspace_path`. `AURACLE_WORKSPACE_PATH`
 * overrides the file, mirroring the `AURACLE_ENGINE_URL` / `AURACLE_API_KEY`
 * env-override precedent used by the engine reader. The IDE never writes this
 * value -- the launcher remains its single writer.
 *
 * `configPath` is injectable for tests; production always uses the canonical
 * `~/.config/auracle/auracle.json`.
 */
export function readProvisionedWorkspacePath(configPath: string = CONFIG_PATH): string | null {
  const override = process.env.AURACLE_WORKSPACE_PATH?.trim();
  if (override) {
    return override;
  }

  try {
    return parseWorkspacePathFromConfig(readFileSync(configPath, 'utf-8'));
  } catch {
    // Missing or unreadable config is a normal state (launcher has not run, or
    // an older launcher without the field) -- fall back to the welcome screen.
    return null;
  }
}
