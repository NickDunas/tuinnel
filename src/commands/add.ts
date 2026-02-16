import { addTunnelToConfig } from '../config/tunnel-config.js';
import { logger } from '../utils/logger.js';
import { validatePort } from '../utils/validation.js';

interface AddOptions {
  subdomain?: string;
  zone?: string;
  adopt?: boolean;
  verbose?: boolean;
}

export async function addCommand(portStr: string, options: AddOptions): Promise<void> {
  try {
    const port = validatePort(portStr)!;

    const result = await addTunnelToConfig({
      port,
      subdomain: options.subdomain,
      zone: options.zone,
      failOnDuplicate: true,
    });

    logger.success(`Added tunnel "${result.name}" — ${result.config.subdomain}.${result.config.zone} <- :${port}`);
    console.error('\nThis saves configuration only. Run `tuinnel up` to start the tunnel.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(msg);
    process.exitCode = 1;
  }
}
