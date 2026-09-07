#!/usr/bin/env node

// Keep command execution out of shared chunks loaded by daemon workers.
// The dispatcher may share dependencies with other entries, but importing it
// must never start another CLI command.
void import('./cliMain').then(({ runHappyCLI }) => runHappyCLI())
