import { afterEach, expect, it } from 'vitest';
import { startE2eFixtureServer } from './e2eFixtureServer.mjs';

let fixture;
afterEach(async () => { await fixture?.close(); });

it('provides authenticated point lookup for created sessions and refreshed agent state', async () => {
    fixture = await startE2eFixtureServer('/unused');
    const url = `${fixture.origin}/v2/sessions/paws-e2e-session`;
    const options = { headers: { Authorization: 'Bearer paws-e2e-token' } };
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url, options)).status).toBe(404);
    fixture.state.sessionCreated = true;
    const response = await fetch(url, options);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ session: {
        id: 'paws-e2e-session', active: true, metadata: expect.any(String), agentState: null,
    } });
    fixture.emitAgentRequest();
    expect(await (await fetch(url, options)).json()).toMatchObject({ session: {
        id: 'paws-e2e-session', agentState: expect.any(String), agentStateVersion: 1,
    } });
    expect((await fetch(`${fixture.origin}/v2/sessions/unknown`, options)).status).toBe(404);
});
