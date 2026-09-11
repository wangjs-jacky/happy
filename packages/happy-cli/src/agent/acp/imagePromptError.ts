/** A rejected image turn can be retried without terminating the ACP session. */
export class AcpImagePromptError extends Error {
  override name = 'AcpImagePromptError';
}
