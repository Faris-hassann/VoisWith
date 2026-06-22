'use client';
import { useEffect, useState } from 'react';

type LogEntry = { timestamp: string; level: string; message: string };
const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
const example = 'Create a UiPath flow that opens Google, searches Facebook, opens Facebook, types Faris as username and faris1234 as password.';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
  return res.json();
}

export default function Home() {
  const [prompt, setPrompt] = useState(example);
  const [messages, setMessages] = useState([{ role: 'assistant', text: 'Describe the UiPath workflow you want to generate. The MVP will create a dry-run project and require confirmation before desktop actions.' }]);
  const [plan, setPlan] = useState<unknown>();
  const [project, setProject] = useState<{ projectJsonPath?: string; projectDir?: string }>();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState('Idle');
  const [error, setError] = useState('');

  async function refreshLogs() { const res = await fetch(`${API}/api/logs`); if (res.ok) setLogs((await res.json()).logs); }
  useEffect(() => { const id = setInterval(refreshLogs, 2500); void refreshLogs(); return () => clearInterval(id); }, []);

  async function generatePlan() {
    setError(''); setStatus('Generating plan');
    setMessages((m) => [...m, { role: 'user', text: prompt }]);
    try { const data = await post<{ plan: unknown }>('/api/agent/generate-plan', { userPrompt: prompt, dryRun: true }); setPlan(data.plan); setMessages((m) => [...m, { role: 'assistant', text: 'Generated a validated dry-run automation plan.' }]); setStatus('Plan ready'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); setStatus('Error'); }
    await refreshLogs();
  }
  async function runMvp() {
    setError(''); setStatus('Running MVP flow');
    try { const data = await post<{ plan: unknown; project: { projectJsonPath: string; projectDir: string } }>('/api/agent/run-mvp', { userPrompt: prompt, dryRun: true }); setPlan(data.plan); setProject(data.project); setStatus('Project generated'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); setStatus('Error'); }
    await refreshLogs();
  }
  async function openStudio() {
    if (!project?.projectJsonPath || !confirm('Open UiPath Studio for review? This is a desktop action.')) return;
    setStatus('Opening Studio');
    try { await post('/api/uipath/open-studio', { projectJsonPath: project.projectJsonPath, confirmed: true }); setStatus('Studio requested'); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); setStatus('Error'); }
  }
  async function stop() { await post('/api/agent/stop', {}); setStatus('Stopped'); await refreshLogs(); }

  return <main className="shell">
    <section className="hero card"><div><h1>AI UiPath Flow Builder</h1><p>Natural language → safe plan → UiPath project files → Studio review.</p></div><div className="badge">Dry-run first MVP</div></section>
    <section className="card"><h2>Chat</h2><div className="chat">{messages.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.text}</div>)}</div><div className="composer"><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} /></div><div className="buttons"><button onClick={generatePlan}>Generate Plan</button><button onClick={runMvp}>Start Desktop Automation</button><button className="danger" onClick={stop}>Stop</button><button className="secondary" onClick={openStudio} disabled={!project?.projectJsonPath}>Open Generated Project</button></div></section>
    <aside className="card"><h2>Status</h2><div className="status"><div className="stat"><span>Current</span>{status}</div><div className="stat"><span>Project</span>{project?.projectDir ?? 'Not generated'}</div><div className="stat"><span>Errors</span>{error || 'None'}</div></div><h2>Generated Plan</h2>{JSON.stringify(plan).includes('Credential') || JSON.stringify(plan).includes('sensitive') ? <p className="warn">Credential-like values may exist in the source prompt. Logs are masked; generated XAML uses secure placeholders for sensitive fields.</p> : null}<pre className="plan">{plan ? JSON.stringify(plan, null, 2) : 'No plan generated yet.'}</pre><h2>Execution Logs</h2><pre className="logs">{logs.map((l) => `${l.timestamp} [${l.level}] ${l.message}`).join('\n') || 'No logs yet.'}</pre></aside>
  </main>;
}
