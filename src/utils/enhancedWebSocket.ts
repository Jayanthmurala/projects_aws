import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { verifyAccessToken } from './jwt';
import { getUserScopeFromJWT } from '../clients/auth';
import { getCache } from './cache';

// Enhanced interfaces with better type safety
export interface ProjectUpdateEvent {
  type: 'new-project' | 'project-updated' | 'project-deleted' | 'task-created' | 'task-updated' | 'comment-added' | 'file-uploaded' | 'file-updated' | 'file-deleted';
  projectId: string;
  collegeId: string;
  departments?: string[];
  visibleToAllDepts?: boolean;
  project?: any;
  task?: any;
  comment?: any;
  attachment?: any;
  createdBy?: { id: string; name: string };
  updatedBy?: { id: string; name: string };
  deletedBy?: { id: string; name: string };
  timestamp: string;
}

export interface ApplicationUpdateEvent {
  type: 'new-application' | 'application-status-changed' | 'application-withdrawn';
  application: any;
  projectId: string;
  collegeId: string;
  timestamp: string;
}

export interface SocketUserData {
  userId: string;
  collegeId?: string;
  department?: string;
  roles: string[];
  connectedAt: Date;
  lastActivity: Date;
}

// Connection management
const activeConnections = new Map<string, Set<string>>(); // userId -> Set of socketIds
const socketUserMap = new Map<string, string>(); // socketId -> userId
const cache = getCache();

let io: SocketIOServer | null = null;

export function initializeWebSocket(server: HttpServer): SocketIOServer {
  console.log('🚀 Initializing WebSocket server on port 4003...');
  
  io = new SocketIOServer(server, {
    cors: {
      origin: ["http://localhost:3000", "http://127.0.0.1:3000", "https://nexus-frontend-pi-ten.vercel.app"],
      methods: ["GET", "POST"],
      credentials: true,
    },
    // Enhanced configuration for production
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    upgradeTimeout: 10000,
    maxHttpBufferSize: 1e6, // 1MB
    allowEIO3: true
  });

  console.log('✅ WebSocket server configured with CORS origins:', ["http://localhost:3000", "http://127.0.0.1:3000"]);

  // Enhanced authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || 
                   socket.handshake.headers.authorization?.replace('Bearer ', '') ||
                   socket.handshake.query.token;
      
      if (!token) {
        console.error('❌ WebSocket connection rejected: No authentication token');
        return next(new Error('Authentication token required'));
      }

      console.log('🔑 WebSocket auth token received, verifying...');

      const payload = await verifyAccessToken(token as string);
      const userScope = getUserScopeFromJWT(payload);
      
      const userData: SocketUserData = {
        userId: payload.sub,
        collegeId: userScope.collegeId,
        department: userScope.department,
        roles: payload.roles || [],
        connectedAt: new Date(),
        lastActivity: new Date()
      };

      socket.data = userData;
      next();
    } catch (error) {
      console.error('WebSocket authentication error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        socketId: socket.id,
        timestamp: new Date().toISOString()
      });
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    console.log('🔌 NEW WEBSOCKET CONNECTION ATTEMPT:', {
      socketId: socket.id,
      handshake: {
        address: socket.handshake.address,
        headers: Object.keys(socket.handshake.headers),
        query: socket.handshake.query,
        auth: socket.handshake.auth ? 'Present' : 'Missing'
      }
    });

    const userData: SocketUserData = socket.data;
    const { userId, collegeId, department, roles } = userData;

    // Track connection
    if (!activeConnections.has(userId)) {
      activeConnections.set(userId, new Set());
    }
    activeConnections.get(userId)!.add(socket.id);
    socketUserMap.set(socket.id, userId);

    console.log(`✅ User ${userId} connected to WebSocket`, {
      socketId: socket.id,
      userId,
      collegeId,
      department,
      roles,
      totalConnections: activeConnections.get(userId)!.size
    });

    // Auto-join rooms based on user role and scope
    setupUserRooms(socket, userData);

    // Handle room management events
    socket.on('join-project', async (data: { projectId: string }) => {
      try {
        const { projectId } = data;
        
        // Validate project access (you might want to check database)
        if (await canUserAccessProject(userId, projectId)) {
          socket.join(`project:${projectId}`);
          socket.emit('project-room-joined', { projectId, userId, timestamp: new Date().toISOString() });
          
          console.log(`✅ User ${userId} joined project room: project:${projectId}`);
        } else {
          socket.emit('error', { message: 'Access denied to project', projectId });
        }
      } catch (error) {
        console.error('Error joining project room:', error);
        socket.emit('error', { message: 'Failed to join project room' });
      }
    });

    socket.on('leave-project', (data: { projectId: string }) => {
      const { projectId } = data;
      socket.leave(`project:${projectId}`);
      socket.emit('project-room-left', { projectId, userId, timestamp: new Date().toISOString() });
      
      console.log(`🚪 User ${userId} left project room: project:${projectId}`);
    });

    // Handle activity tracking
    socket.on('activity', () => {
      userData.lastActivity = new Date();
    });

    // Handle heartbeat/ping
    socket.on('ping', (callback) => {
      userData.lastActivity = new Date();
      if (typeof callback === 'function') {
        callback('pong');
      }
    });

    // Enhanced disconnect handling
    socket.on('disconnect', (reason) => {
      console.log(`User ${userId} disconnected from WebSocket`, {
        socketId: socket.id,
        reason,
        duration: Date.now() - userData.connectedAt.getTime(),
        timestamp: new Date().toISOString()
      });

      // Clean up connection tracking
      const userSockets = activeConnections.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          activeConnections.delete(userId);
        }
      }
      socketUserMap.delete(socket.id);
    });

    // Handle connection errors
    socket.on('error', (error) => {
      console.error(`WebSocket error for user ${userId}:`, {
        error: error.message,
        socketId: socket.id,
        timestamp: new Date().toISOString()
      });
    });
  });

  // Periodic cleanup of inactive connections
  setInterval(() => {
    cleanupInactiveConnections();
  }, 300000); // 5 minutes

  return io;
}

// Setup user rooms based on role and scope
function setupUserRooms(socket: any, userData: SocketUserData) {
  const { userId, collegeId, department, roles } = userData;

  // Join college-specific room for project updates
  if (collegeId) {
    socket.join(`college:${collegeId}`);
    console.log(`User ${userId} joined college room: college:${collegeId}`);
  }

  // Join department-specific room if needed
  if (collegeId && department) {
    socket.join(`department:${collegeId}:${department}`);
    console.log(`User ${userId} joined department room: department:${collegeId}:${department}`);
  }

  // Role-specific rooms
  if (roles.includes('FACULTY')) {
    socket.join(`faculty:${userId}:notifications`);
    console.log(`Faculty ${userId} joined notifications room`);
  }

  if (roles.includes('STUDENT')) {
    socket.join(`student:${userId}:notifications`);
    console.log(`Student ${userId} joined notifications room`);
  }

  // Admin rooms
  if (roles.some(role => ['HEAD_ADMIN', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN', 'SUPER_ADMIN'].includes(role))) {
    socket.join(`admin:${userId}:notifications`);
    console.log(`Admin ${userId} joined admin notifications room`);
  }
}

// Enhanced project update emission with better targeting
export function emitProjectUpdate(event: ProjectUpdateEvent): void {
  if (!io) {
    console.error('❌ WebSocket not initialized, cannot emit project update');
    return;
  }

  const { projectId, collegeId, departments, visibleToAllDepts } = event;
  
  // Add timestamp
  event.timestamp = new Date().toISOString();

  console.log('🚀 EMITTING PROJECT UPDATE:', {
    type: event.type,
    projectId,
    collegeId,
    connectedClients: io.engine.clientsCount
  });

  // Emit to project-specific room (for active collaborators)
  if (io) {
    const projectRoom = `project:${projectId}`;
    io.to(projectRoom).emit('project-update', event);
    console.log(`📡 Emitted to project room: ${projectRoom}`);
  }

  // Emit to college room
  if (collegeId && io) {
    const collegeRoom = `college:${collegeId}`;
    io.to(collegeRoom).emit('project-update', event);
    console.log(`📡 Emitted to college room: ${collegeRoom}`);
  }

  // Emit to specific departments if not visible to all
  if (!visibleToAllDepts && departments && departments.length > 0 && io) {
    departments.forEach(dept => {
      io!.to(`department:${collegeId}:${dept}`).emit('project-update', event);
    });
  }

  console.log(`📡 Emitted project update:`, {
    type: event.type,
    projectId,
    collegeId,
    departments: departments || [],
    visibleToAllDepts,
    timestamp: event.timestamp
  });
}

// Enhanced application update emission
export function emitApplicationUpdate(facultyUserId: string, event: ApplicationUpdateEvent): void {
  if (!io) return;

  // Add timestamp
  event.timestamp = new Date().toISOString();

  // Emit to faculty notifications room
  if (io) {
    io.to(`faculty:${facultyUserId}:notifications`).emit('application-update', event);
  }
  
  console.log(`📧 Emitted application update to faculty ${facultyUserId}:`, {
    type: event.type,
    projectId: event.projectId,
    timestamp: event.timestamp
  });
}

// Enhanced notification system
export function emitNotification(userId: string, notification: any): void {
  if (!io) return;

  const enhancedNotification = {
    ...notification,
    timestamp: new Date().toISOString(),
    id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  };

  // Try multiple room patterns to ensure delivery
  if (io) {
    io.to(`student:${userId}:notifications`).emit('notification', enhancedNotification);
    io.to(`faculty:${userId}:notifications`).emit('notification', enhancedNotification);
    io.to(`admin:${userId}:notifications`).emit('notification', enhancedNotification);
  }

  console.log(`🔔 Emitted notification to user ${userId}:`, {
    type: notification.type,
    id: enhancedNotification.id,
    timestamp: enhancedNotification.timestamp
  });
}

// Broadcast system message to all connected users
export function broadcastSystemMessage(message: string, type: 'info' | 'warning' | 'error' = 'info'): void {
  if (!io) return;

  const systemMessage = {
    type: 'system-message',
    level: type,
    message,
    timestamp: new Date().toISOString()
  };

  if (io) {
    io.emit('system-message', systemMessage);
  }
  console.log(`📢 Broadcasted system message: ${message}`);
}

// Get connection statistics
export function getConnectionStats(): {
  totalConnections: number;
  uniqueUsers: number;
  roomCounts: { [room: string]: number };
} {
  if (!io) {
    return { totalConnections: 0, uniqueUsers: 0, roomCounts: {} };
  }

  const roomCounts: { [room: string]: number } = {};
  
  // Get room information
  if (io) {
    for (const [roomName, room] of io.sockets.adapter.rooms) {
      if (!roomName.startsWith('/')) { // Skip socket ID rooms
        roomCounts[roomName] = room.size;
      }
    }
  }

  return {
    totalConnections: io ? io.sockets.sockets.size : 0,
    uniqueUsers: activeConnections.size,
    roomCounts
  };
}

// Cleanup inactive connections
function cleanupInactiveConnections(): void {
  if (!io) return; // Guard against null io
  
  const now = Date.now();
  const inactiveThreshold = 30 * 60 * 1000; // 30 minutes

  for (const [userId, socketIds] of activeConnections) {
    for (const socketId of socketIds) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket && socket.data) {
        const lastActivity = socket.data.lastActivity?.getTime() || 0;
        if (now - lastActivity > inactiveThreshold) {
          console.log(`Disconnecting inactive socket: ${socketId} for user: ${userId}`);
          socket.disconnect(true);
        }
      }
    }
  }
}

// Helper function to check project access (placeholder)
async function canUserAccessProject(userId: string, projectId: string): Promise<boolean> {
  // TODO: Implement actual project access check
  // This should verify that the user has permission to access the project
  try {
    const cacheKey = `project_access:${userId}:${projectId}`;
    const cached = await cache.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    // In a real implementation, you would check the database
    // For now, return true (but this should be implemented properly)
    const hasAccess = true;
    
    // Cache the result for 5 minutes
    await cache.set(cacheKey, JSON.stringify(hasAccess), 300);
    return hasAccess;
  } catch (error) {
    console.error('Error checking project access:', error);
    return false;
  }
}

export function getWebSocketInstance(): SocketIOServer | null {
  return io;
}

export function getWebSocketHealth() {
  if (!io) {
    return {
      status: 'unhealthy' as const,
      connections: 0,
      uptime: 0,
      lastError: 'WebSocket not initialized'
    };
  }

  return {
    status: 'healthy' as const,
    connections: io.engine.clientsCount || 0,
    uptime: process.uptime(),
  };
}

