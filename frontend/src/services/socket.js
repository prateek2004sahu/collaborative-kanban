import { io } from 'socket.io-client';

let socket = null;

/** One shared socket for the whole app. The JWT is sent in the handshake. */
export function getSocket() {
  if (!localStorage.getItem('token')) return null;
  if (!socket) {
    socket = io(import.meta.env.VITE_API_URL || undefined, {
      // function form => the latest token is read again on every reconnect
      auth: (cb) => cb({ token: localStorage.getItem('token') }),
      reconnectionDelayMax: 4000,
    });
  }
  return socket;
}

export function closeSocket() {
  if (socket) socket.close();
  socket = null;
}
