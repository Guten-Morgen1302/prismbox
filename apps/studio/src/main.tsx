import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LocalApp } from './local/LocalApp';
import './styles.css';

/** Local mode when this page is served by the prismbox daemon, otherwise the Playground. */
async function detectLocal(): Promise<boolean> {
  try {
    const res = await fetch('/__prism/session', { signal: AbortSignal.timeout(1500) });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return false;
    return ((await res.json()) as { prismbox?: boolean }).prismbox === true;
  } catch {
    return false;
  }
}

const local = await detectLocal();
createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode>{local ? <LocalApp /> : <App />}</StrictMode>);
