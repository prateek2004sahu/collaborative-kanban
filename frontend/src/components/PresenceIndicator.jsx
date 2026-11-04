import { initials } from './TaskCard';

export default function PresenceIndicator({ users, meId, status }) {
  return (
    <div className="presence" title={users.map((u) => u.name).join(', ')}>
      <span className={`dot ${status}`} />
      <span className="muted small">
        {status === 'connected' ? `${users.length} online` : status === 'reconnecting' ? 'Reconnecting…' : status === 'denied' ? 'No access' : 'Connecting…'}
      </span>
      <div className="avatars">
        {users.slice(0, 6).map((u) => <span key={u.userId} className={`avatar ${u.userId === meId ? 'me' : ''}`} title={u.name}>{initials(u.name)}</span>)}
        {users.length > 6 && <span className="avatar">+{users.length - 6}</span>}
      </div>
    </div>
  );
}
