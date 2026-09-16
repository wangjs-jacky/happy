import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { ConnectionStatus } from '../contracts.js';
import type { Api } from './api.js';
import { Button } from '../../vendor/agents-party/src/ui/components/button.js';
import { Input } from '../../vendor/agents-party/src/ui/components/input.js';

const labels = { disconnected: '未连接', linking: '等待扫码授权', connecting: '连接中', ready: '已连接', error: '连接失败' };
export function ConnectionPanel({ status, api, active, onChange }: { status: ConnectionStatus; api: Api; active: boolean; onChange: (status: ConnectionStatus) => void }) {
  const [serverUrl, setServerUrl] = useState(status.serverUrl ?? 'http://47.115.228.20:3005');
  const [qr, setQr] = useState('');
  const [linking, setLinking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const operation = useRef(0);
  useEffect(() => () => { operation.current += 1; }, []);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true; setQr('');
    if (status.qrUrl) void QRCode.toDataURL(status.qrUrl).then(value => { if (current) setQr(value); }).catch(() => { if (current) setError('二维码生成失败，请重试连接。'); });
    return () => { current = false; };
  }, [status.qrUrl]);
  const perform = async (disconnect: boolean) => {
    const current = ++operation.current;
    setLinking(!disconnect); setCancelling(disconnect); setError('');
    try {
      const next = await api<ConnectionStatus>('/api/paws/link', disconnect ? { method: 'DELETE' } : { method: 'POST', body: JSON.stringify({ serverUrl }) });
      if (current === operation.current) onChange(next);
    } catch (error) { if (current === operation.current) setError((error as Error).message); }
    finally { if (current === operation.current) { setLinking(false); setCancelling(false); } }
  };
  return <details className="border-b border-border px-4 py-2" open={status.state !== 'ready'}>
    <summary className="font-accent text-sm">Paws：{labels[status.state]}{status.serverUrl ? ` · ${status.serverUrl}` : ''}</summary>
    <div className="flex flex-wrap items-end gap-3 py-2">
      <label className="min-w-64 flex-1 text-sm">SDK 服务地址<Input value={serverUrl} onChange={event => setServerUrl(event.target.value)} disabled={linking || cancelling || active} /></label>
      <Button disabled={linking || cancelling || active || !serverUrl.trim()} onClick={() => void perform(false)}>连接 / 扫码授权</Button>
      <Button variant="secondary" disabled={cancelling || active || (!linking && status.state === 'disconnected')} onClick={() => void perform(true)}>断开连接</Button>
      {qr && <img src={qr} alt="使用 Paws 扫码授权" className="size-44" />}
      <p className="text-xs text-muted-foreground">使用 Paws 正常扫码授权；凭据只保留在此服务内存。{active ? '先停止所有协调，才能断开或切换账号。' : ''}</p>
      {(error || status.error) && <p role="alert" className="text-destructive">{error || status.error}</p>}
    </div>
  </details>;
}
