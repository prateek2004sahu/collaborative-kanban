import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';
import { useSocketEvent } from '../hooks/useRealtime';

export const describe = (a) => {
  const d = a.details || {};
  const who = a.userName || 'Someone';
  const t = d.title || d.name || '';
  switch (`${a.entityType}:${a.action}`) {
    case 'task:created': return `${who} created task “${t}”`;
    case 'task:updated': return `${who} edited “${t}” (${Object.keys(d.changes || {}).join(', ')})`;
    case 'task:moved': return `${who} moved “${t}” from ${d.fromColumn} to ${d.toColumn}`;
    case 'task:deleted': return `${who} deleted task “${t}”`;
    default: return `${who} ${a.action} ${a.entityType} “${t}”`;
  }
};

/** Live, tenant-scoped activity feed. Pass entityId to see one task's history. */
export default function ActivityLog({ tenantId, entityId, limit = 30, reloadKey }) {
  const [items, setItems] = useState([]);
  const load = useCallback(() => {
    api.get('/activity', { params: { limit, entityId } }).then((r) => setItems(r.data)).catch(() => {});
  }, [limit, entityId]);
  useEffect(() => { setItems([]); load(); }, [load, tenantId, reloadKey]);
  useSocketEvent('activity:created', ({ activity }) => {
    if (activity.tenantId !== tenantId) return;
    if (entityId && activity.entityId !== entityId) return;
    setItems((l) => [activity, ...l.filter((x) => x.id !== activity.id)].slice(0, limit));
  });
  if (!items.length) return <div className="muted small">No activity yet.</div>;
  return (
    <ul className="activity">
      {items.map((a) => (
        <li key={a.id}><div>{describe(a)}</div><div className="muted small">{new Date(a.createdAt).toLocaleString()}</div></li>
      ))}
    </ul>
  );
}
