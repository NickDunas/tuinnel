import { execSync } from 'child_process';
import { platform } from 'os';

let clipboardAvailable: boolean | null = null;

function detectClipboard(): { available: boolean; command: string | null } {
  if (platform() === 'darwin') {
    return { available: true, command: 'pbcopy' };
  }
  // Linux: try xclip, then xsel
  try {
    execSync('which xclip', { stdio: 'ignore' });
    return { available: true, command: 'xclip -selection clipboard' };
  } catch {}
  try {
    execSync('which xsel', { stdio: 'ignore' });
    return { available: true, command: 'xsel --clipboard --input' };
  } catch {}
  return { available: false, command: null };
}

export function isClipboardAvailable(): boolean {
  if (clipboardAvailable === null) {
    clipboardAvailable = detectClipboard().available;
  }
  return clipboardAvailable;
}

export function copyToClipboard(text: string): boolean {
  const { available, command } = detectClipboard();
  if (!available || !command) return false;
  try {
    execSync(command, { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}
