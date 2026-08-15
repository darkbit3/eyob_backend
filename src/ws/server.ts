import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import jwt from 'jsonwebtoken';

interface AuthenticatedClient {
  ws: WebSocket;
  userId?: string;
  isAlive: boolean;
}

const clients = new Set<AuthenticatedClient>();

export function setupWebSocket(server: http.Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req) => {
    const client: AuthenticatedClient = { ws, isAlive: true };
    clients.add(client);

    // Try extracting auth token from URL query string ?token=...
    try {
      const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
      const token = url.searchParams.get('token');
      if (token && process.env.JWT_SECRET) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET) as any;
        if (decoded && (decoded.userId || decoded.id)) {
          client.userId = decoded.userId || decoded.id;
        }
      }
    } catch (_e) {
      // Unauthenticated client (still receives public broadcasts)
    }

    ws.on('pong', () => {
      client.isAlive = true;
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth' && msg.token && process.env.JWT_SECRET) {
          const decoded = jwt.verify(msg.token, process.env.JWT_SECRET) as any;
          if (decoded && (decoded.userId || decoded.id)) {
            client.userId = decoded.userId || decoded.id;
            ws.send(JSON.stringify({ type: 'authenticated', userId: client.userId }));
          }
        }
      } catch (_err) {}
    });

    ws.on('close', () => {
      clients.delete(client);
    });

    ws.on('error', () => {
      clients.delete(client);
    });

    // Send connection established handshake
    ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
  });

  // Heartbeat ping every 30s to clean stale connections
  const interval = setInterval(() => {
    for (const client of clients) {
      if (!client.isAlive) {
        client.ws.terminate();
        clients.delete(client);
        continue;
      }
      client.isAlive = false;
      client.ws.ping();
    }
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  return wss;
}

/**
 * Broadcast message to a specific user (e.g., wallet balance update, direct notification)
 */
export function sendToUser(userId: string, payload: any) {
  const data = JSON.stringify(payload);
  for (const client of clients) {
    if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  }
}

/**
 * Broadcast message to all connected clients (e.g., auction updates, global announcements)
 */
export function broadcastAll(payload: any) {
  const data = JSON.stringify(payload);
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  }
}
