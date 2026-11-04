import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../services/socket';

/**
 * Joins the tenant's Socket.IO room and tracks connection status + presence.
 *  - status: 'connecting' | 'connected' | 'reconnecting' | 'denied'
 *  - onResync(): called after a RE-connection so the caller can refetch the
 *    authoritative state (we can't assume we received every event while offline).
 */
export function useRealtime(tenantId, onResync) {
  const [status, setStatus] = useState('connecting');
  const [presence, setPresence] = useState([]);
  const resyncRef = useRef(onResync);
  resyncRef.current = onResync;

  useEffect(() => {
    if (!tenantId) return undefined;
    const socket = getSocket();
    if (!socket) return undefined;
    let cancelled = false;
    let firstJoin = true;
    setStatus('connecting');

    const join = () => socket.emit('tenant:join', { tenantId }, (res) => {
      if (cancelled) return;
      if (res?.ok) {
        setPresence(res.presence);
        setStatus('connected');
        if (!firstJoin) resyncRef.current?.();   // we were offline: reconcile with the DB
        firstJoin = false;
      } else {
        setStatus('denied');
      }
    });
    const onDisconnect = () => setStatus('reconnecting');
    const onPresence = (p) => { if (p.tenantId === tenantId) setPresence(p.users); };

    socket.on('connect', join);          // fires on the first connect AND on every reconnect
    socket.on('disconnect', onDisconnect);
    socket.on('presence:update', onPresence);
    if (socket.connected) join();

    return () => {
      cancelled = true;
      socket.off('connect', join);
      socket.off('disconnect', onDisconnect);
      socket.off('presence:update', onPresence);
      socket.emit('tenant:leave');
      setPresence([]);
    };
  }, [tenantId]);

  return { status, presence };
}

/** Subscribe to one socket event for the lifetime of the component. */
export function useSocketEvent(event, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const fn = (payload) => ref.current(payload);
    socket.on(event, fn);
    return () => socket.off(event, fn);
  }, [event]);
}
