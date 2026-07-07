import { createServer } from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createFileStore } from './store';
import { createImageGatewayService } from './service';
import { adminPage, jobPage, publicPage } from './pages';
import { readBytes, readInput, redirect, requireToken, sendHtml, sendJson } from './http';

const port = Number(process.env.IMAGE_GATEWAY_PORT ?? 3010);
const dataPath = process.env.IMAGE_GATEWAY_DATA ?? './data/image-gateway.json';
const resultDir = process.env.IMAGE_GATEWAY_RESULT_DIR ?? join(dirname(dataPath), 'results');
const adminToken = process.env.IMAGE_GATEWAY_ADMIN_TOKEN;
const workerToken = process.env.IMAGE_GATEWAY_WORKER_TOKEN;
const hashSecret = process.env.IMAGE_GATEWAY_HASH_SECRET ?? workerToken ?? adminToken ?? 'dev-secret-change-me';

const service = createImageGatewayService({
    store: createFileStore(dataPath),
    ipHashSecret: hashSecret,
});

const server = createServer(async (request, response) => {
    try {
        const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
        const pathname = url.pathname.replace(/\/$/, '') || '/';

        if (request.method === 'GET' && pathname === '/health') {
            sendJson(response, 200, { status: 'ok' });
            return;
        }

        if (request.method === 'GET' && (pathname === '/image' || pathname === '/')) {
            sendHtml(response, 200, publicPage(await service.getSettings()));
            return;
        }

        if (request.method === 'POST' && pathname === '/image/jobs') {
            const input = await readInput(request);
            const job = await service.submitJob({
                prompt: String(input.prompt ?? ''),
                ip: getRequesterIp(request),
                userAgent: String(request.headers['user-agent'] ?? ''),
            });
            if (acceptsHtml(request)) {
                redirect(response, `/image/jobs/${job.id}`);
            } else {
                sendJson(response, 201, job);
            }
            return;
        }

        const jobMatch = pathname.match(/^\/image\/jobs\/([^/]+)$/);
        if (request.method === 'GET' && jobMatch) {
            const job = await service.getJob(jobMatch[1]!);
            if (!job) {
                sendJson(response, 404, { error: 'Job not found' });
                return;
            }
            if (acceptsHtml(request)) {
                sendHtml(response, 200, jobPage(job));
            } else {
                sendJson(response, 200, job);
            }
            return;
        }

        const resultMatch = pathname.match(/^\/image\/results\/([A-Za-z0-9_.-]+)$/);
        if (request.method === 'GET' && resultMatch) {
            const fileName = resultMatch[1]!;
            const filePath = join(resultDir, fileName);
            if (!filePath.startsWith(resultDir)) {
                sendJson(response, 400, { error: 'Invalid result path' });
                return;
            }
            try {
                const bytes = await readFile(filePath);
                response.writeHead(200, {
                    'content-type': fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') ? 'image/jpeg' : 'image/png',
                    'cache-control': 'public, max-age=31536000, immutable',
                });
                response.end(bytes);
            } catch {
                sendJson(response, 404, { error: 'Result not found' });
            }
            return;
        }

        if (pathname === '/image/admin' && request.method === 'GET') {
            if (!requireToken(request, adminToken, url.searchParams.get('token'))) {
                sendJson(response, 401, { error: 'Admin token required' });
                return;
            }
            sendHtml(response, 200, adminPage(
                await service.getSettings(),
                await service.getWorkerHealth(),
                await service.listJobs(),
                url.searchParams.get('token') ?? '',
            ));
            return;
        }

        if (pathname === '/image/admin/worker' && request.method === 'GET') {
            if (!requireToken(request, adminToken, url.searchParams.get('token'))) {
                sendJson(response, 401, { error: 'Admin token required' });
                return;
            }
            sendJson(response, 200, await service.getWorkerHealth());
            return;
        }

        if (pathname === '/image/admin/mode' && request.method === 'POST') {
            if (!requireToken(request, adminToken, url.searchParams.get('token'))) {
                sendJson(response, 401, { error: 'Admin token required' });
                return;
            }
            const input = await readInput(request);
            const mode = input.mode;
            if (mode !== 'open' && mode !== 'review' && mode !== 'closed') {
                sendJson(response, 400, { error: 'Invalid mode' });
                return;
            }
            await service.updateSettings({ mode });
            redirect(response, `/image/admin?token=${encodeURIComponent(url.searchParams.get('token') ?? '')}`);
            return;
        }

        const adminActionMatch = pathname.match(/^\/image\/admin\/jobs\/([^/]+)\/(approve|reject)$/);
        if (request.method === 'POST' && adminActionMatch) {
            if (!requireToken(request, adminToken, url.searchParams.get('token'))) {
                sendJson(response, 401, { error: 'Admin token required' });
                return;
            }
            if (adminActionMatch[2] === 'approve') {
                await service.approveJob(adminActionMatch[1]!);
            } else {
                await service.rejectJob(adminActionMatch[1]!);
            }
            redirect(response, `/image/admin?token=${encodeURIComponent(url.searchParams.get('token') ?? '')}`);
            return;
        }

        if (pathname === '/image/worker/claim' && request.method === 'POST') {
            if (!requireToken(request, workerToken, url.searchParams.get('token'))) {
                sendJson(response, 401, { error: 'Worker token required' });
                return;
            }
            sendJson(response, 200, { job: await service.claimNextJob() });
            return;
        }

        const workerReportMatch = pathname.match(/^\/image\/worker\/jobs\/([^/]+)\/(succeed|fail)$/);
        if (request.method === 'POST' && workerReportMatch) {
            if (!requireToken(request, workerToken, url.searchParams.get('token'))) {
                sendJson(response, 401, { error: 'Worker token required' });
                return;
            }
            const input = await readInput(request);
            const job = workerReportMatch[2] === 'succeed'
                ? await service.reportSuccess(workerReportMatch[1]!, {
                    resultUrl: String(input.resultUrl ?? ''),
                    actualCostCents: input.actualCostCents ? Number(input.actualCostCents) : undefined,
                })
                : await service.reportFailure(workerReportMatch[1]!, String(input.error ?? 'Worker failed'));
            sendJson(response, 200, job);
            return;
        }

        const workerUploadMatch = pathname.match(/^\/image\/worker\/jobs\/([^/]+)\/result$/);
        if (request.method === 'PUT' && workerUploadMatch) {
            if (!requireToken(request, workerToken, url.searchParams.get('token'))) {
                sendJson(response, 401, { error: 'Worker token required' });
                return;
            }
            const jobId = workerUploadMatch[1]!;
            const contentType = String(request.headers['content-type'] ?? 'image/png').toLowerCase();
            const extension = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';
            const bytes = await readBytes(request);
            if (bytes.length === 0) {
                sendJson(response, 400, { error: 'Empty upload' });
                return;
            }
            if (bytes.length > 20 * 1024 * 1024) {
                sendJson(response, 413, { error: 'Upload too large' });
                return;
            }
            await mkdir(resultDir, { recursive: true });
            const fileName = `${jobId}.${extension}`;
            await writeFile(join(resultDir, fileName), bytes);
            sendJson(response, 200, { resultUrl: `/image/results/${fileName}` });
            return;
        }

        sendJson(response, 404, { error: 'Not found' });
    } catch (error) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : 'Unknown error' });
    }
});

server.listen(port, () => {
    console.log(`image-gateway listening on :${port}`);
});

function getRequesterIp(request: import('node:http').IncomingMessage): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded) {
        return forwarded.split(',')[0]!.trim();
    }
    return request.socket.remoteAddress ?? 'unknown';
}

function acceptsHtml(request: import('node:http').IncomingMessage): boolean {
    return String(request.headers.accept ?? '').includes('text/html');
}
