import { diffParts } from '../session';
import type { DiffEntry } from '../session';

function Row({ e }: { e: DiffEntry }) {
  const p = diffParts(e.before, e.after);
  const time = new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <div className={`diff-row ${e.kind}`}>
      <div className="diff-meta">
        <code>Hero.tsx:{e.line}</code>
        <span className="diff-summary">{e.summary}</span>
        <span className="author">{e.author}</span>
        <span className="time">{time}</span>
      </div>
      <pre className="hunk del"><span className="sign">-</span>{p.prefix}<mark>{p.removed}</mark>{p.suffix}</pre>
      <pre className="hunk add"><span className="sign">+</span>{p.prefix}<mark>{p.inserted}</mark>{p.suffix}</pre>
    </div>
  );
}

export interface DiffStripProps {
  log: DiffEntry[];
  canUndo: boolean;
  canRedo: boolean;
  error: string | null;
  onUndo: () => void;
  onRedo: () => void;
}

export function DiffStrip({ log, canUndo, canRedo, error, onUndo, onRedo }: DiffStripProps) {
  const last = log[0];
  return (
    <section className="panel diff-strip" aria-label="Changes">
      <div className="panel-head">
        <span>Changes</span>
        <span className="count">{log.length === 0 ? 'none yet' : `${log.length} ${log.length === 1 ? 'edit' : 'edits'}`}</span>
        <span className="spacer" />
        <span className="status-slot" data-state={error ? 'error' : last ? 'saved' : 'idle'}>
          {error ? 'refused' : last ? 'saved in this browser' : 'idle'}
        </span>
        <button type="button" className="btn ghost" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">Undo</button>
        <button type="button" className="btn ghost" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">Redo</button>
      </div>
      {error && <div className="diff-error" role="alert">{error}</div>}
      <div className="diff-list">
        {log.length === 0 ? (
          <div className="empty small"><p>Edits appear here as the exact one-line patch written to <code>Hero.tsx</code>. Nothing has changed yet.</p></div>
        ) : (
          log.map((e) => <Row key={e.id} e={e} />)
        )}
      </div>
    </section>
  );
}
