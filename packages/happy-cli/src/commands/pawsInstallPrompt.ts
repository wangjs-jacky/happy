import { createInterface } from 'node:readline/promises';

import chalk from 'chalk';

import { installSlashCommand, isSlashCommandInstalled } from './attach';

type PromptResult = 'installed' | 'declined' | 'skipped' | 'already-installed';

type PromptRuntime = {
  homeDir?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  startedBy?: 'daemon' | 'terminal';
  ask?: (question: string) => Promise<string>;
  log?: (message: string) => void;
};

function answerIsYes(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === 'y' || normalized === 'yes';
}

async function askQuestion(runtime: Required<Pick<PromptRuntime, 'stdin' | 'stdout'>> & Pick<PromptRuntime, 'ask'>, question: string): Promise<string> {
  if (runtime.ask) {
    return runtime.ask(question);
  }

  const rl = createInterface({
    input: runtime.stdin,
    output: runtime.stdout,
  });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

export async function promptInstallSlashCommandIfNeeded(runtime: PromptRuntime = {}): Promise<PromptResult> {
  const env = runtime.env ?? process.env;
  const stdin = runtime.stdin ?? process.stdin;
  const stdout = runtime.stdout ?? process.stdout;
  const log = runtime.log ?? console.log;

  if (runtime.startedBy === 'daemon') return 'skipped';
  if (env.HAPPY_SKIP_PAWS_INSTALL_PROMPT === '1') return 'skipped';
  if (stdin.isTTY !== true || stdout.isTTY !== true) return 'skipped';

  if (await isSlashCommandInstalled({ homeDir: runtime.homeDir })) {
    return 'already-installed';
  }

  log('');
  log(chalk.bold('Install /paws slash command?'));
  log('Use /paws inside Claude Code or Codex to move the current session to Paws mobile.');
  const answer = await askQuestion(
    { stdin, stdout, ask: runtime.ask },
    chalk.cyan('Install /paws now? (Y/n): '),
  );

  if (!answerIsYes(answer) && answer.trim().length > 0) {
    log(`You can install it later with: ${chalk.cyan('happy attach --install-slash-command')}`);
    return 'declined';
  }

  const installed = await installSlashCommand({ homeDir: runtime.homeDir });
  log(`Installed /paws skill:\n${installed.map((path) => `- ${path}`).join('\n')}`);
  return 'installed';
}
