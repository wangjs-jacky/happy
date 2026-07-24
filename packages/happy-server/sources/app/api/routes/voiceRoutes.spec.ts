import fastify from "fastify";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Fastify } from "../types";

vi.mock("@/utils/log", () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() }));

import { voiceRoutes } from "./voiceRoutes";

async function createApp() {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
    typed.decorate("authenticate", async (request: any) => {
        request.userId = "voice-settings-test-user";
    });
    voiceRoutes(typed);
    await typed.ready();
    return typed;
}

describe("voiceRoutes — GET /v1/voice/usage", () => {
    let app: Fastify;

    beforeEach(() => {
        process.env.HANDY_MASTER_SECRET = "voice-settings-test-secret";
        delete process.env.REVENUECAT_API_KEY;
    });

    afterEach(async () => {
        if (app) {
            await app.close();
        }
        vi.unstubAllGlobals();
        delete process.env.ELEVENLABS_API_KEY;
    });

    it("marks voice usage unavailable when voice usage is not configured", async () => {
        delete process.env.ELEVENLABS_API_KEY;
        app = await createApp();

        const response = await app.inject({
            method: "GET",
            url: "/v1/voice/usage",
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ available: false });
    });

    it("marks voice usage unavailable when the usage provider is unavailable", async () => {
        process.env.ELEVENLABS_API_KEY = "test-key";
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("provider unavailable")));
        app = await createApp();

        const response = await app.inject({
            method: "GET",
            url: "/v1/voice/usage",
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ available: false });
    });

    it("does not request a conversation token when the usage provider rejects the query", async () => {
        process.env.ELEVENLABS_API_KEY = "test-key";
        process.env.REVENUECAT_API_KEY = "test-revenuecat-key";
        const fetchMock = vi.fn().mockResolvedValue({
            ok: false,
            status: 429,
        });
        vi.stubGlobal("fetch", fetchMock);
        app = await createApp();

        const response = await app.inject({
            method: "POST",
            url: "/v1/voice/conversations",
            payload: { agentId: "test-agent" },
        });

        expect(response.statusCode).toBe(500);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
