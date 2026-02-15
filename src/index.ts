#!/usr/bin/env node

import { Command } from 'commander';
import { setVerbose } from './utils/logger.js';

const VERSION = '0.1.0';

const program = new Command();

program
  .name('tuinnel')
  .description('Cloudflare Tunnel manager')
  .version(VERSION, '-v, --version')
  .configureHelp({ showGlobalOptions: true })
  .helpCommand(false);

// Global options
program.option('--verbose', 'Enable verbose output');

// Wire up verbose flag before any command runs
program.hook('preAction', (thisCommand) => {
  const opts = thisCommand.optsWithGlobals();
  if (opts.verbose) {
    setVerbose(true);
  }
});

// Bare command: open TUI dashboard (or port shorthand)
program
  .argument('[port]', 'Quick start on a port')
  .action(async (port: string | undefined, _options, command) => {
    const globalOpts = command.optsWithGlobals();
    if (globalOpts.verbose) setVerbose(true);

    const { openDashboard } = await import('./commands/dashboard.js');

    if (port && /^\d+$/.test(port)) {
      await openDashboard(parseInt(port, 10));
      return;
    }

    await openDashboard();
  });

// tuinnel init
program
  .command('init')
  .description('Set up Cloudflare account')
  .action(async () => {
    const { initCommand } = await import('./commands/init.js');
    await initCommand();
  });

// tuinnel up [ports...]
program
  .command('up')
  .description('Start tunnels (TUI dashboard)')
  .argument('[ports...]', 'Ports to tunnel')
  .option('-q, --quick', 'Quick tunnel (no account needed)')
  .option('--no-tui', 'Plain log output instead of TUI')
  .alias('start')
  .action(async (ports: string[], options, command) => {
    const globalOpts = command.optsWithGlobals();
    const { upCommand } = await import('./commands/up.js');
    await upCommand(ports, { ...options, ...globalOpts });
  });

// tuinnel down [names...]
program
  .command('down')
  .description('Stop tunnels')
  .argument('[names...]', 'Tunnel names to stop')
  .option('-c, --clean', 'Delete tunnel and DNS records')
  .option('-a, --all', 'Stop all running tunnels')
  .alias('stop')
  .action(async (names: string[], options, command) => {
    const globalOpts = command.optsWithGlobals();
    const { downCommand } = await import('./commands/down.js');
    await downCommand(names, { ...options, ...globalOpts });
  });

// tuinnel add <port>
program
  .command('add')
  .description('Add tunnel config (does NOT start tunnel)')
  .argument('<port>', 'Local port to tunnel')
  .option('-s, --subdomain <name>', 'Subdomain name (required in non-interactive mode)')
  .option('-z, --zone <domain>', 'Zone/domain to use')
  .option('--adopt', 'Adopt existing Cloudflare tunnel')
  .action(async (port: string, options, command) => {
    const globalOpts = command.optsWithGlobals();
    const { addCommand } = await import('./commands/add.js');
    await addCommand(port, { ...options, ...globalOpts });
  });

// tuinnel remove <name>
program
  .command('remove')
  .description('Remove tunnel from config')
  .argument('<name>', 'Tunnel name')
  .alias('rm')
  .action(async (name: string, options, command) => {
    const globalOpts = command.optsWithGlobals();
    const { removeCommand } = await import('./commands/remove.js');
    await removeCommand(name, { ...options, ...globalOpts });
  });

// tuinnel list
program
  .command('list')
  .description('List configured tunnels')
  .option('--json', 'Output as JSON')
  .alias('ls')
  .action(async (options, command) => {
    const globalOpts = command.optsWithGlobals();
    const { listCommand } = await import('./commands/list.js');
    await listCommand({ ...options, ...globalOpts });
  });

// tuinnel status
program
  .command('status')
  .description('Check running tunnel status')
  .option('--json', 'Output as JSON')
  .action(async (options, command) => {
    const globalOpts = command.optsWithGlobals();
    const { statusCommand } = await import('./commands/status.js');
    await statusCommand({ ...options, ...globalOpts });
  });

// tuinnel zones
program
  .command('zones')
  .description('List Cloudflare zones')
  .option('--json', 'Output as JSON')
  .action(async (options, command) => {
    const globalOpts = command.optsWithGlobals();
    const { zonesCommand } = await import('./commands/zones.js');
    await zonesCommand({ ...options, ...globalOpts });
  });

// tuinnel doctor
program
  .command('doctor')
  .description('Run diagnostics')
  .action(async () => {
    const { doctorCommand } = await import('./commands/doctor.js');
    await doctorCommand();
  });

// tuinnel purge
program
  .command('purge')
  .description('Clean orphaned Cloudflare resources')
  .action(async () => {
    const { purgeCommand } = await import('./commands/purge.js');
    await purgeCommand();
  });

// MUST use parseAsync for async action handlers
await program.parseAsync(process.argv);
