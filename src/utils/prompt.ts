import { createInterface } from 'readline';

export async function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      resolve(trimmed || defaultValue || '');
    });
  });
}

export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === '') resolve(defaultYes);
      else resolve(trimmed === 'y' || trimmed === 'yes');
    });
  });
}

export async function promptWithValidation(
  question: string,
  validate: (input: string) => string | null,
): Promise<string> {
  while (true) {
    const answer = await prompt(question);
    const error = validate(answer);
    if (!error) return answer;
    console.error(`Error: ${error}`);
  }
}
