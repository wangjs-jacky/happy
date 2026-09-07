import { createWorkerSessionStartupLifecycleFromEnvironment } from './api/sessionStartupTrace'

// Record entry before loading the command's authentication, UI or processor graph.
const startupLifecycle = createWorkerSessionStartupLifecycleFromEnvironment()

void import('./commands/codexCommand')
  .then(({ runCodexWorkerCommand }) => runCodexWorkerCommand(process.argv.slice(2), { startupLifecycle }))
  .catch(() => {
    // Startup failures must not expose credentials, working paths or resume arguments.
    console.error('CODEX_WORKER_START_FAILED')
    process.exit(1)
  })
