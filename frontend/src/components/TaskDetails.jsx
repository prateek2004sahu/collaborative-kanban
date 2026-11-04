import { useEffect, useMemo, useState } from 'react';

const FIELDS = ['title', 'description', 'assignedTo', 'priority', 'dueDate', 'labels'];
const toForm = (t) => ({ title: t.title, description: t.description, assignedTo: t.assignedTo || '', priority: t.priority, dueDate: t.dueDate || '', labels: (t.labels || []).join(', ') });
const toApi = (k, v) => k === 'assignedTo' ? (v || null) : k === 'dueDate' ? (v || null) : k === 'labels' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v;

/**
 * Side panel to view/edit a task.
 * Conflict strategy (field-level):
 *   - we remember the version our form was based on (baseVersion)
 *   - only the fields the user actually CHANGED are sent
 *   - if the task changed on the server meanwhile -> banner with two choices:
 *       "Load latest"  = discard my edits
 *       "Keep mine"    = re-apply only my changed fields on top of the latest version
 */
export default function TaskDetails({ task, columns, members, canEdit, canDelete, onSave, onDelete, onClose, activityNode }) {
  const [form, setForm] = useState(() => toForm(task));
  const [base, setBase] = useState({ version: task.version, form: toForm(task) });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const changed = useMemo(() => FIELDS.filter((k) => form[k] !== base.form[k]), [form, base]);
  const dirty = changed.length > 0;
  const stale = task.version !== base.version;
  const conflict = stale && dirty;

  // Someone else changed the task:
  //  - no unsaved edits of mine  -> silently follow the latest version
  //  - I have unsaved edits      -> refresh only the fields I did NOT touch, keep my edits and
  //                                 keep the old base version so the conflict banner stays visible
  useEffect(() => {
    if (!stale) return;
    const latest = toForm(task);
    if (!dirty) { setForm(latest); setBase({ version: task.version, form: latest }); return; }
    const pick = (mine, theirs) => Object.fromEntries(FIELDS.map((k) => [k, changed.includes(k) ? mine[k] : theirs[k]]));
    setForm((f) => pick(f, latest));
    setBase((b) => ({ version: b.version, form: pick(b.form, latest) }));
  }, [task.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const columnName = columns.find((c) => c.id === task.columnId)?.name;

  const save = async (version) => {
    setSaving(true); setMsg('');
    const fields = Object.fromEntries(changed.map((k) => [k, toApi(k, form[k])]));
    const res = await onSave(task.id, fields, version);
    setSaving(false);
    if (res.ok) { setBase({ version: res.task.version, form }); setMsg('Saved ✓'); }
    else if (res.conflict) setMsg('Someone saved first — choose how to resolve below.');
  };
  const loadLatest = () => { setForm(toForm(task)); setBase({ version: task.version, form: toForm(task) }); setMsg(''); };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div><span className="muted">Status:</span> <strong>{columnName}</strong> <span className="muted">· v{task.version}</span></div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {conflict && (
          <div className="banner warn">
            <strong>This task was updated by someone else</strong> while you were editing it.
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn sm" onClick={loadLatest}>Load latest (discard mine)</button>
              <button className="btn primary sm" disabled={saving} onClick={() => save(task.version)}>Keep mine ({changed.join(', ')})</button>
            </div>
          </div>
        )}

        <label>Title<input value={form.title} onChange={set('title')} disabled={!canEdit} maxLength={200} /></label>
        <label>Description<textarea rows={5} value={form.description} onChange={set('description')} disabled={!canEdit} /></label>
        <div className="grid2">
          <label>Assignee
            <select value={form.assignedTo} onChange={set('assignedTo')} disabled={!canEdit}>
              <option value="">Unassigned</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label>Priority
            <select value={form.priority} onChange={set('priority')} disabled={!canEdit}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
          </label>
          <label>Due date<input type="date" value={form.dueDate} onChange={set('dueDate')} disabled={!canEdit} /></label>
          <label>Labels (comma separated)<input value={form.labels} onChange={set('labels')} disabled={!canEdit} /></label>
        </div>

        <div className="muted small">Created {new Date(task.createdAt).toLocaleString()} · Updated {new Date(task.updatedAt).toLocaleString()}</div>

        <div className="row" style={{ marginTop: 14 }}>
          {canEdit && <button className="btn primary" disabled={!dirty || saving || conflict} onClick={() => save(base.version)}>{saving ? 'Saving…' : 'Save changes'}</button>}
          {canDelete && <button className="btn danger" onClick={() => { if (window.confirm('Delete this task?')) onDelete(task.id); }}>Delete</button>}
          <span className="muted small">{msg}</span>
        </div>
        <h4>History</h4>
        {activityNode}
      </aside>
    </div>
  );
}
