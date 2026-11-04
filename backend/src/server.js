const http = require('http');
const env = require('./config/env');
const app = require('./app');
const sockets = require('./sockets');

const server = http.createServer(app);
sockets.init(server);

server.listen(env.port, () => console.log(`🚀 API + WebSocket server on http://localhost:${env.port}`));
