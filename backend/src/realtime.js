/** Tiny holder so REST routes can broadcast without importing socket code. */
let io = null;
const roomOf = (tenantId) => `tenant:${tenantId}`;

module.exports = {
  roomOf,
  setIO: (instance) => { io = instance; },
  /** Broadcast to everyone currently inside ONE tenant's room. Call AFTER the DB commit. */
  emitToTenant(tenantId, event, payload) {
    if (io) io.to(roomOf(tenantId)).emit(event, payload);
  },
};
