import { useEffect, useState } from 'react';
import {
  connectStaticDemoCloud,
  getStaticDemoCloudStatus,
  subscribeStaticDemoCloudStatus,
  type StaticDemoCloudStatus,
} from '../lib/staticDemoApi';
import './static-demo-cloud-sync.css';

export function StaticDemoCloudSync(): JSX.Element {
  const [status, setStatus] = useState<StaticDemoCloudStatus>(() => getStaticDemoCloudStatus());
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [gistId, setGistId] = useState('');

  useEffect(() => subscribeStaticDemoCloudStatus(() => setStatus(getStaticDemoCloudStatus())), []);

  const connect = async () => {
    try {
      await connectStaticDemoCloud({ token, gistId });
      setToken('');
      setOpen(false);
      window.location.reload();
    } catch {
      // The status panel presents the actionable error without exposing the token.
    }
  };

  return (
    <aside className="static-demo-sync" aria-live="polite">
      <button className="static-demo-sync__trigger" onClick={() => setOpen(true)} type="button">
        {status.connected ? (status.syncing ? '云端同步中' : '已同步到私有 Gist') : '连接云端演示数据'}
      </button>
      {open ? (
        <div className="static-demo-sync__dialog" role="dialog" aria-modal="true" aria-label="连接云端演示数据">
          <div className="static-demo-sync__header">
            <div>
              <strong>云端演示数据</strong>
              <p>使用你的私有 GitHub Gist 保存并恢复演示数据。</p>
            </div>
            <button aria-label="关闭" className="static-demo-sync__close" onClick={() => setOpen(false)} type="button">×</button>
          </div>
          <label>
            GitHub token（仅保留在当前浏览器会话）
            <input autoComplete="off" onChange={(event) => setToken(event.target.value)} placeholder="github_pat_… 或 ghp_…" type="password" value={token} />
          </label>
          <label>
            既有 Gist ID（首次连接可留空）
            <input autoComplete="off" onChange={(event) => setGistId(event.target.value)} placeholder="留空将创建一个私有 Gist" value={gistId} />
          </label>
          {status.connected && status.gistId ? <p className="static-demo-sync__gist">当前 Gist ID：<code>{status.gistId}</code></p> : null}
          {status.error ? <p className="static-demo-sync__error">{status.error}</p> : null}
          <button className="static-demo-sync__connect" disabled={status.syncing || !token.trim()} onClick={() => void connect()} type="button">
            {status.syncing ? '正在连接…' : '连接并同步'}
          </button>
        </div>
      ) : null}
    </aside>
  );
}
