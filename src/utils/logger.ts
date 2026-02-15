import chalk from 'chalk';

let verbose = false;

export function setVerbose(value: boolean): void {
  verbose = value;
}

export function isVerbose(): boolean {
  return verbose;
}

export const logger = {
  info(message: string): void {
    process.stderr.write(chalk.blue('info') + '  ' + message + '\n');
  },

  warn(message: string): void {
    process.stderr.write(chalk.yellow('warn') + '  ' + message + '\n');
  },

  error(message: string): void {
    process.stderr.write(chalk.red('error') + ' ' + message + '\n');
  },

  success(message: string): void {
    process.stderr.write(chalk.green('ok') + '    ' + message + '\n');
  },

  debug(message: string): void {
    if (verbose) {
      process.stderr.write(chalk.gray('debug') + ' ' + message + '\n');
    }
  },
};
