/**
 * Socket.IO server
 * ---------------------------------------------------------------
 *  - Authentication : JWT in the handshake (socket.handshake.auth.token)
 *  - Authorization  : a client may only join a tenant room after the server
 *                     re-checks the user's membership in the database.
 *  - Rooms          : one room per tenant -> "tenant:<tenantId>". A socket is
 *                     in AT MOST ONE tenant room at a time.
 *  - Presence       : tracked per tenant, per user (a user with 2 tabs is
 *                     still ONE online user; they go offline when the last
 *                     tab disconnects).
 *  - Writes         : clients never mutate data over the socket. All writes
 *                     go through REST (single place for RBAC + validation);
 *                     the server broadcasts AFTER the DB commit.
 */
const { Server } = require('socket.io');
const env = require('../config/env');
const { verifyToken } = require('../middleware/auth');
const { getTenantAccess } = require('../services/access.service');
const { setIO, roomOf } = require('../realtime');

// tenantId -> Map(userId -> { name, sockets:Set<socketId> })
const presence = new Map();

const snapshot = (tenantId) =>
  [...(presence.get(tenantId) || new Map()).entries()].map(([userId, p]) => ({ userId, name: p.name }));

function addPresence(tenantId, user, socketId) {
  if (!presence.has(tenantId)) presence.set(tenantId, new Map());
  const users = presence.get(tenantId);
  const isNewUser = !users.has(user.id);
  if (isNewUser) users.set(user.id, { name: user.name, sockets: new Set() });
  users.get(user.id).sockets.add(socketId);
  return isNewUser; // true => the list of online users changed
}

function removePresence(tenantId, userId, socketId) {
  const users = presence.get(tenantId);
  if (!users || !users.has(userId)) return false;
  const p = users.get(userId);
  p.sockets.delete(socketId);
  if (p.sockets.size) return false; // user still has another tab open
  users.delete(userId);
  if (!users.size) presence.delete(tenantId);
  return true; // user went offline
}

function init(httpServer) {
  const io = new Server(httpServer, { cors: { origin: env.clientOrigin, credentials: true } });
  setIO(io);

  // 1) Authenticate every connection
  io.use((socket, next) => {
    try {
      socket.data.user = verifyToken(socket.handshake.auth && socket.handshake.auth.token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;

    const leaveCurrent = () => {
      const current = socket.data.tenantId;
      if (!current) return;
      socket.leave(roomOf(current));
      const changed = removePresence(current, user.id, socket.id);
      socket.data.tenantId = null;
      if (changed) io.to(roomOf(current)).emit('presence:update', { tenantId: current, users: snapshot(current) });
    };

    // 2) Join a tenant room (ack-based so the client knows the result)
    socket.on('tenant:join', async (payload, ack = () => {}) => {
      try {
        const tenantId = payload && payload.tenantId;
        const access = await getTenantAccess(user.id, tenantId); // DB check, never trust the client
        if (!access) return ack({ ok: false, error: 'forbidden' });
        if (socket.data.tenantId === tenantId) {
          return ack({ ok: true, role: access.role, presence: snapshot(tenantId) });
        }
        leaveCurrent();
        socket.join(roomOf(tenantId));
        socket.data.tenantId = tenantId;
        const changed = addPresence(tenantId, user, socket.id);
        if (changed) io.to(roomOf(tenantId)).emit('presence:update', { tenantId, users: snapshot(tenantId) });
        ack({ ok: true, role: access.role, presence: snapshot(tenantId) });
      } catch (e) {
        console.error('tenant:join failed', e);
        ack({ ok: false, error: 'server_error' });
      }
    });

    socket.on('tenant:leave', (_p, ack = () => {}) => { leaveCurrent(); ack({ ok: true }); });

    socket.on('disconnect', leaveCurrent);
  });

  return io;
}

module.exports = { init, snapshot };
