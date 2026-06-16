import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Download, Pause, Play, RefreshCcw, Save, Trash2, Upload } from 'lucide-react';
import './style.css';
import { DEFAULT_CONFIG } from './shared/domain';
import type { ApplyLog, AutoApplyConfig, RuntimeState } from './shared/types';

type Snapshot = {
  config: AutoApplyConfig;
  logs: ApplyLog[];
  state: RuntimeState;
};

const fallbackState: RuntimeState = {
  status: 'idle',
  todayAppliedCount: 0,
  updatedAt: new Date().toISOString(),
};

function App() {
  const [config, setConfig] = useState<AutoApplyConfig>(DEFAULT_CONFIG);
  const [logs, setLogs] = useState<ApplyLog[]>([]);
  const [state, setState] = useState<RuntimeState>(fallbackState);
  const [notice, setNotice] = useState('正在读取扩展状态...');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const statusLabel = useMemo(() => {
    const labels: Record<RuntimeState['status'], string> = {
      idle: '空闲',
      running: '运行中',
      paused: '已暂停',
      waiting_for_user: '等待人工处理',
      error: '页面异常',
    };
    return labels[state.status];
  }, [state.status]);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const snapshot = await sendMessage<Snapshot>({ type: 'GET_STATE' });
    if (snapshot) {
      setConfig(snapshot.config);
      setLogs(snapshot.logs);
      setState(snapshot.state);
      setNotice(snapshot.state.lastReason ?? '状态已更新');
    } else {
      setNotice('请在浏览器扩展弹窗中使用此页面');
    }
  }

  async function saveConfig(nextConfig = config) {
    await chrome.storage.local.set({ autoApplyConfig: nextConfig });
    setConfig(nextConfig);
    setNotice('配置已保存');
  }

  async function start() {
    await saveConfig({ ...config, enabled: true });
    await sendMessage({ type: 'START_AUTO_APPLY' });
    await refresh();
  }

  async function pause() {
    await sendMessage({ type: 'PAUSE_AUTO_APPLY', reason: '用户手动暂停' });
    await refresh();
  }

  async function clearApplyLogs() {
    await sendMessage({ type: 'CLEAR_LOGS' });
    await refresh();
  }

  function update<K extends keyof AutoApplyConfig>(key: K, value: AutoApplyConfig[K]) {
    setConfig((previous) => ({ ...previous, [key]: value }));
  }

  function exportConfig() {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'boss-auto-apply-config.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importConfig(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    const parsed = JSON.parse(text) as Partial<AutoApplyConfig>;
    const next = { ...DEFAULT_CONFIG, ...parsed };
    await saveConfig(next);
  }

  return (
    <main className="popup">
      <header className="topbar">
        <div>
          <h1>Boss 辅助投递</h1>
          <p>只在已登录 Boss 直聘页面内运行，遇到验证或异常会暂停。</p>
        </div>
        <button className="icon-button" onClick={refresh} title="刷新状态" type="button">
          <RefreshCcw size={17} />
        </button>
      </header>

      <section className={`status status-${state.status}`}>
        <div>
          <span>当前状态</span>
          <strong>{statusLabel}</strong>
        </div>
        <div>
          <span>今日进度</span>
          <strong>
            {state.todayAppliedCount}/{config.dailyLimit}
          </strong>
        </div>
        <p>{state.lastReason ?? notice}</p>
      </section>

      {state.debugInfo ? (
        <section className="debug-panel">
          <div className="debug-title">
            <strong>错误详情</strong>
            <span>{state.debugInfo.phase}</span>
          </div>
          <dl>
            <div>
              <dt>时间</dt>
              <dd>{new Date(state.debugInfo.createdAt).toLocaleString()}</dd>
            </div>
            {state.debugInfo.tabUrl ? (
              <div>
                <dt>页面</dt>
                <dd>{state.debugInfo.tabUrl}</dd>
              </div>
            ) : null}
            {state.debugInfo.message ? (
              <div>
                <dt>错误</dt>
                <dd>{state.debugInfo.message}</dd>
              </div>
            ) : null}
          </dl>
          {state.debugInfo.details?.length ? (
            <pre>{state.debugInfo.details.join('\n')}</pre>
          ) : null}
          {state.debugInfo.stack ? <pre>{state.debugInfo.stack}</pre> : null}
        </section>
      ) : null}

      <section className="actions">
        <button onClick={start} type="button">
          <Play size={16} />启动
        </button>
        <button onClick={pause} type="button">
          <Pause size={16} />暂停
        </button>
        <button onClick={() => void saveConfig()} type="button">
          <Save size={16} />保存
        </button>
      </section>

      <section className="form-grid">
        <label>
          岗位关键词
          <input
            value={config.keywords.join(', ')}
            onChange={(event) =>
              update(
                'keywords',
                event.target.value
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean),
              )
            }
            placeholder="前端, React"
          />
        </label>
        <label>
          城市
          <input value={config.city} onChange={(event) => update('city', event.target.value)} placeholder="上海" />
        </label>
        <label>
          薪资下限 K
          <input
            type="number"
            value={config.salaryMin ?? ''}
            onChange={(event) => update('salaryMin', event.target.value ? Number(event.target.value) : null)}
          />
        </label>
        <label>
          薪资上限 K
          <input
            type="number"
            value={config.salaryMax ?? ''}
            onChange={(event) => update('salaryMax', event.target.value ? Number(event.target.value) : null)}
          />
        </label>
        <label>
          每日上限
          <input type="number" value={config.dailyLimit} onChange={(event) => update('dailyLimit', Number(event.target.value))} />
        </label>
        <label>
          最小间隔秒
          <input type="number" value={config.delayMinSec} onChange={(event) => update('delayMinSec', Number(event.target.value))} />
        </label>
        <label>
          最大间隔秒
          <input type="number" value={config.delayMaxSec} onChange={(event) => update('delayMaxSec', Number(event.target.value))} />
        </label>
      </section>

      <label className="templates">
        沟通模板
        <textarea
          value={config.messageTemplates.join('\n')}
          onChange={(event) =>
            update(
              'messageTemplates',
              event.target.value
                .split('\n')
                .map((item) => item.trim())
                .filter(Boolean),
            )
          }
        />
      </label>

      <section className="actions secondary">
        <input
          ref={fileInputRef}
          hidden
          type="file"
          accept="application/json"
          onChange={(event) => void importConfig(event.target.files?.[0])}
        />
        <button onClick={() => fileInputRef.current?.click()} type="button">
          <Upload size={16} />导入配置
        </button>
        <button onClick={exportConfig} type="button">
          <Download size={16} />导出配置
        </button>
        <button onClick={clearApplyLogs} type="button">
          <Trash2 size={16} />清空日志
        </button>
      </section>

      <section className="logs">
        <h2>投递日志</h2>
        {logs.length === 0 ? (
          <p className="empty">暂无日志</p>
        ) : (
          <ul>
            {logs.slice(0, 30).map((log) => (
              <li key={log.id}>
                <strong>{log.jobTitle || '任务暂停'}</strong>
                <span>{log.status}</span>
                <p>
                  {[log.company, log.city, log.salary].filter(Boolean).join(' · ')}
                  {log.reason ? ` · ${log.reason}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

async function sendMessage<T = unknown>(message: unknown): Promise<T | null> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    return null;
  }
  return chrome.runtime.sendMessage(message);
}

createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
