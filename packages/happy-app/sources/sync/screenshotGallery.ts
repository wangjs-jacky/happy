import { MMKV } from 'react-native-mmkv';
import {
    documentDirectory,
    makeDirectoryAsync,
    getInfoAsync,
    writeAsStringAsync,
    EncodingType,
} from 'expo-file-system/legacy';

const mmkv = new MMKV();
const KEY = 'screenshot-gallery-v1';

/**
 * 单条截图记录。base64 PNG 落盘后只保留 file:// 本地路径，避免 MMKV 里堆大块 base64。
 */
export interface ScreenshotEntry {
    id: string;
    uri: string;                 // file:// 本地路径
    source: 'manual' | 'ai';
    target: 'desktop' | 'browser';
    note?: string;
    remoteId?: string;           // CLI 临时缓存里的 id（AI 路径懒拉取去重用）
    createdAt: number;
}

/** 全部会话的图库：sessionId -> 该会话的截图列表 */
type AllGalleries = Record<string, ScreenshotEntry[]>;

// ============ 纯函数（不依赖 MMKV，便于单测）============

/** 按 createdAt 倒序（新图在前）。返回新数组，不修改入参。 */
function sortDesc(entries: ScreenshotEntry[]): ScreenshotEntry[] {
    return [...entries].sort((a, b) => b.createdAt - a.createdAt);
}

/** 把一条记录插入到某会话列表，返回新的全量图库（不修改入参）。 */
function upsert(all: AllGalleries, sessionId: string, entry: ScreenshotEntry): AllGalleries {
    const prev = all[sessionId] ?? [];
    return {
        ...all,
        [sessionId]: [...prev, entry],
    };
}

// ============ MMKV 读写（薄包装）============

/** 读全部图库；解析失败时退回空对象（永不抛错）。 */
function readAll(): AllGalleries {
    const raw = mmkv.getString(KEY);
    if (!raw) {
        return {};
    }
    try {
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object') ? parsed as AllGalleries : {};
    } catch (e) {
        console.error('Failed to parse screenshot gallery', e);
        return {};
    }
}

/** 写回全部图库。 */
function writeAll(all: AllGalleries): void {
    mmkv.set(KEY, JSON.stringify(all));
}

// ============ 对外 API ============

/** 读取某会话的截图列表，按 createdAt 倒序（新图在前）。 */
export function loadGallery(sessionId: string): ScreenshotEntry[] {
    const all = readAll();
    return sortDesc(all[sessionId] ?? []);
}

/** 生成稳定唯一 id 并把一条记录入库，返回带 id 的完整记录。 */
export function addScreenshotEntry(sessionId: string, entry: Omit<ScreenshotEntry, 'id'>): ScreenshotEntry {
    const id = `${entry.createdAt}_${Math.random().toString(36).slice(2, 10)}`;
    const full: ScreenshotEntry = { ...entry, id };
    const all = readAll();
    writeAll(upsert(all, sessionId, full));
    return full;
}

/** 该会话是否已存在某 remoteId 的记录（Task 3.1 懒拉取去重用）。 */
export function hasRemoteId(sessionId: string, remoteId: string): boolean {
    const all = readAll();
    const list = all[sessionId] ?? [];
    return list.some((e) => e.remoteId === remoteId);
}

// ============ base64 落盘工具（IO，不进单测）============

/**
 * 把 base64 PNG 写入 documentDirectory/screenshots/<id>.png，返回 file:// uri。
 * 目录不存在先建。用 expo-file-system/legacy（与仓库现有用法一致）。
 */
export async function saveBase64Png(base64: string): Promise<string> {
    if (!documentDirectory) {
        throw new Error('documentDirectory 不可用，无法保存截图');
    }
    const dir = `${documentDirectory}screenshots/`;
    const info = await getInfoAsync(dir);
    if (!info.exists) {
        await makeDirectoryAsync(dir, { intermediates: true });
    }
    const fileId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const uri = `${dir}${fileId}.png`;
    await writeAsStringAsync(uri, base64, { encoding: EncodingType.Base64 });
    return uri;
}
