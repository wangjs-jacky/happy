import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { sendPushNotifications } from "./pushSend";

function createServiceAccountJson() {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    return JSON.stringify({
        type: "service_account",
        project_id: "happy-coder-9fe36",
        client_email: "firebase-adminsdk@test.iam.gserviceaccount.com",
        private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    });
}

describe("sendPushNotifications", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        process.env = { ...originalEnv };
        vi.restoreAllMocks();
    });

    afterEach(() => {
        process.env = originalEnv;
        vi.restoreAllMocks();
    });

    it("sends native Android tokens through FCM HTTP v1", async () => {
        process.env.FCM_SERVICE_ACCOUNT_JSON = createServiceAccountJson();
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ access_token: "ya29.test-access-token", expires_in: 3600 }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ name: "projects/happy-coder-9fe36/messages/123" }),
            });
        vi.stubGlobal("fetch", fetchMock);

        const tickets = await sendPushNotifications([{
            to: "fcm-device-token",
            title: "Ready",
            body: "Codex finished",
            data: { sessionId: "session-1", kind: "done", retries: 2 },
            sound: "default",
            channelId: "messages",
        }]);

        expect(tickets).toEqual([{ status: "ok", id: "projects/happy-coder-9fe36/messages/123" }]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][0]).toBe("https://oauth2.googleapis.com/token");
        expect(fetchMock.mock.calls[1][0]).toBe("https://fcm.googleapis.com/v1/projects/happy-coder-9fe36/messages:send");
        expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer ya29.test-access-token");

        const body = JSON.parse(fetchMock.mock.calls[1][1].body);
        expect(body).toMatchObject({
            message: {
                token: "fcm-device-token",
                notification: {
                    title: "Ready",
                    body: "Codex finished",
                },
                android: {
                    priority: "HIGH",
                    notification: {
                        channel_id: "messages",
                        sound: "default",
                    },
                },
                data: {
                    sessionId: "session-1",
                    kind: "done",
                    retries: "2",
                },
            },
        });
    });

    it("keeps Expo push tokens on the Expo Push API", async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce({
            ok: true,
            json: async () => ({ data: [{ status: "ok", id: "expo-ticket-1" }] }),
        });
        vi.stubGlobal("fetch", fetchMock);

        const tickets = await sendPushNotifications([{
            to: "ExponentPushToken[expo-device]",
            title: "Ready",
            body: "Codex finished",
            data: { sessionId: "session-1", kind: "done" },
            sound: "default",
            channelId: "messages",
        }]);

        expect(tickets).toEqual([{ status: "ok", id: "expo-ticket-1" }]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe("https://exp.host/--/api/v2/push/send");
    });

    it("returns a clear error for native Android tokens when FCM credentials are not configured", async () => {
        delete process.env.FCM_SERVICE_ACCOUNT_JSON;
        delete process.env.FCM_PROJECT_ID;
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const tickets = await sendPushNotifications([{
            to: "fcm-device-token",
            title: "Ready",
            body: "Codex finished",
        }]);

        expect(tickets).toEqual([{
            status: "error",
            message: "FCM credentials are not configured",
            details: { error: "InvalidCredentials" },
        }]);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
