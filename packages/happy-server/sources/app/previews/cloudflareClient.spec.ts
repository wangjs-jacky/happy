import { describe, expect, it, vi } from 'vitest';
import { createCloudflareClient } from '@/app/previews/cloudflareClient';
import { createHash } from 'node:crypto';
import { blake3 } from '@noble/hashes/blake3';

const account = 'a'.repeat(32);
const ok = (result: unknown) => new Response(JSON.stringify({ success: true, result }), { status: 200 });
const project = 'happy-previews-test';
const deployment = { id: 'deploy-1', url: `https://abc.${project}.pages.dev`, environment: 'preview', latest_stage: { status: 'success' }, deployment_trigger: { metadata: { branch: 'attempt', commit_message: '{}' } } };

describe('Cloudflare Pages client', () => {
    it('uploads Pages asset hashes, emits a preview multipart deployment with owned headers and checkpoints readiness', async () => {
        const digest = createHash('sha256').update('configuration').digest('hex');
        const projectName = `happy-previews-${digest.slice(0, 20)}`;
        const bytes = Buffer.from('<h1>Public</h1>');
        const sha = createHash('sha256').update(bytes).digest('hex');
        const key = Buffer.from(blake3(bytes.toString('base64') + 'html')).toString('hex').slice(0, 32);
        const pagesDeployment = { ...deployment, url: `https://abc.${projectName}.pages.dev` };
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(ok({ name: projectName, production_branch: `paws-reserved-${digest.slice(0, 32)}` }))
            .mockResolvedValueOnce(ok({ jwt: 'asset-upload-jwt' }))
            .mockResolvedValueOnce(ok(null))
            .mockResolvedValueOnce(ok(null))
            .mockResolvedValueOnce(ok(pagesDeployment));
        const client = createCloudflareClient({ token: 'account-token', teamId: account, fetchImpl });
        await client.ensurePreviewProject({ configurationId: 'configuration' });
        await client.uploadFile(sha, bytes, 'text/html');
        const files = [{ file: 'index.html', sha, size: bytes.length }];
        await client.prepareDeployment(files);
        const onCreated = vi.fn(async () => {});
        const ready = await client.createDeployment({ name: projectName, projectId: projectName, files, meta: { happyPreviewId: 'preview', happyPublicationAttemptId: 'attempt' }, onCreated });
        expect(ready.readyState).toBe('READY');
        expect(onCreated).toHaveBeenCalledWith({ id: `cfpages:${account}:${projectName}:deploy-1` });
        expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toEqual([{ key, value: bytes.toString('base64'), metadata: { contentType: 'text/html' }, base64: true }]);
        expect(fetchImpl.mock.calls[2][1].headers.Authorization).toBe('Bearer asset-upload-jwt');
        const form = fetchImpl.mock.calls[4][1].body as FormData;
        expect(JSON.parse(form.get('manifest') as string)).toEqual({ '/index.html': key });
        expect(form.get('branch')).toBe('p-attempt');
        expect(await (form.get('_headers') as Blob).text()).toContain('Cache-Control: no-store');
        expect(form.get('_worker.js')).toBeNull();
        expect(fetchImpl.mock.calls[4][1].headers.Authorization).toBe('Bearer account-token');
        expect(fetchImpl.mock.calls.every(([, init]) => init.redirect === 'error')).toBe(true);
    });

    it('does not adopt an unowned project', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(ok({ name: 'happy-previews-unrelated', production_branch: 'main' }));
        await expect(createCloudflareClient({ token: 'token', teamId: account, fetchImpl }).ensurePreviewProject({ configurationId: 'config' })).rejects.toThrow('ownership');
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('reconciles only a matching branch and metadata', async () => {
        const matching = { ...deployment, deployment_trigger: { metadata: { branch: 'p-attempt', commit_message: JSON.stringify({ happyPreviewId: 'preview', happyPublicationAttemptId: 'attempt' }) } } };
        const fetchImpl = vi.fn(async () => ok([matching]));
        const client = createCloudflareClient({ token: 'token', teamId: account, fetchImpl });
        await expect(client.lookupDeploymentByMetadata({ projectId: project, happyPreviewId: 'preview', publicationAttemptId: 'attempt' })).resolves.toMatchObject({ visibility: 'ready' });
        await expect(client.lookupDeploymentByMetadata({ projectId: project, happyPreviewId: 'other', publicationAttemptId: 'attempt' })).resolves.toEqual({ visibility: 'not_found' });
    });

    it('validates scoped account access without echoing provider secrets', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(ok([]));
        await createCloudflareClient({ token: 'secret', teamId: account, fetchImpl }).verifyConnection();
        expect(fetchImpl.mock.calls[0][0]).toContain(`/accounts/${account}/pages/projects`);
        const failing = vi.fn().mockResolvedValue(new Response(JSON.stringify({ errors: [{ message: 'secret' }] }), { status: 403 }));
        await expect(createCloudflareClient({ token: 'secret', teamId: account, fetchImpl: failing }).verifyConnection()).rejects.toThrow('Cloudflare request failed: http_403');
    });

    it('never deletes a legacy provider id or a deployment from another account', async () => {
        const fetchImpl = vi.fn();
        const client = createCloudflareClient({ token: 'secret', teamId: account, fetchImpl });
        await expect(client.deleteDeployment('dpl_legacy')).rejects.toThrow();
        await expect(client.deleteDeployment(`cfpages:${'b'.repeat(32)}:${project}:deploy-1`)).rejects.toThrow();
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('validates preview environment before deleting and removes branch aliases', async () => {
        const fetchImpl = vi.fn().mockResolvedValueOnce(ok(deployment)).mockResolvedValueOnce(ok(null));
        await createCloudflareClient({ token: 'secret', teamId: account, fetchImpl }).deleteDeployment(`cfpages:${account}:${project}:deploy-1`);
        expect(fetchImpl.mock.calls[1][0]).toContain('/deployments/deploy-1?force=true');
        expect(fetchImpl.mock.calls[1][1].method).toBe('DELETE');
        const prod = vi.fn().mockResolvedValue(ok({ ...deployment, environment: 'production' }));
        await expect(createCloudflareClient({ token: 'secret', teamId: account, fetchImpl: prod }).deleteDeployment(`cfpages:${account}:${project}:deploy-1`)).rejects.toThrow('preview');
        expect(prod).toHaveBeenCalledTimes(1);
    });

    it('does not retry an ambiguous deployment POST', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
        const client = createCloudflareClient({ token: 'secret', teamId: account, fetchImpl });
        await expect(client.createDeployment({ name: project, projectId: project, files: [], meta: { happyPreviewId: 'id', happyPublicationAttemptId: 'attempt' } })).rejects.toThrow();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});
