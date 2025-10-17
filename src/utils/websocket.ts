import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { verifyAccessToken } from './jwt';
import { getUserScopeFromJWT } from '../clients/auth';

export interface ProjectUpdateEvent {
  type: 'new-project' | 'project-updated' | 'project-deleted';
  project: any;
  collegeId: string;
  departments: string[];
  visibleToAllDepts: boolean;
}

export interface ApplicationUpdateEvent {
  type: 'new-application' | 'application-status-changed' | 'application-withdrawn';
  application: any;
  projectId: string;
  collegeId: string;
}

let io: SocketIOServer | null = null;

export function initializeWebSocket(server: HttpServer): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const payload = await verifyAccessToken(token);
      const userScope = getUserScopeFromJWT(payload);
      
      socket.data = {
        userId: payload.sub,
        collegeId: userScope.collegeId,
        department: userScope.department,
        roles: payload.roles || [],
      };

      next();
    } catch (error) {
      console.error('WebSocket authentication error:', error);
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, collegeId, department, roles } = socket.data;
    console.log(`User ${userId} connected to WebSocket`, {
      userId,
      collegeId,
      department,
      roles,
      isFaculty: roles.includes('FACULTY') || roles.includes('faculty')
    });

    // Join college-specific room for project updates
    if (collegeId) {
      socket.join(`projects:${collegeId}`);
      console.log(`User ${userId} joined room: projects:${collegeId}`);
    }

    // Join department-specific room if needed
    if (collegeId && department) {
      socket.join(`projects:${collegeId}:${department}`);
      console.log(`User ${userId} joined room: projects:${collegeId}:${department}`);
    }

    // Faculty join their own project rooms for application updates
    if ((roles.includes('FACULTY') || roles.includes('faculty')) && collegeId) {
      socket.join(`faculty:${userId}:applications`);
      console.log(`Faculty ${userId} joined application updates room`);
    }

    // Handle joining specific project rooms for real-time collaboration
    socket.on('join-project', (projectId: string) => {
      socket.join(`project:${projectId}`);
      console.log(`✅ User ${userId} joined project room: project:${projectId}`);
      
      // Send confirmation back to client
      socket.emit('project-room-joined', { projectId, userId });
    });

    socket.on('leave-project', (projectId: string) => {
      socket.leave(`project:${projectId}`);
      console.log(`🚪 User ${userId} left project room: project:${projectId}`);
      
      // Send confirmation back to client
      socket.emit('project-room-left', { projectId, userId });
    });

    socket.on('disconnect', () => {
      console.log(`User ${userId} disconnected from WebSocket`);
    });
  });

  return io;
}

export function getWebSocketInstance(): SocketIOServer | null {
  return io;
}

// Emit project updates to relevant users
export function emitProjectUpdate(projectId: string, event: any): void {
  if (!io) {
    console.error('❌ WebSocket not initialized, cannot emit project update');
    return;
  }

  // For task-related events, emit to project room
  console.log(`📡 Emitting project update for project ${projectId}:`, event);
  io!.to(`project:${projectId}`).emit('project-update', event);
  console.log(`✅ Emitted project update to room: project:${projectId}`);
}

// Emit project updates to relevant users (original function)
export function emitProjectUpdateToCollege(event: ProjectUpdateEvent): void {
  if (!io) return;

  const { collegeId, departments, visibleToAllDepts } = event;

  // Emit to college room (all users in college will receive)
  io!.to(`projects:${collegeId}`).emit('project-update', event);

  // If not visible to all departments, emit to specific department rooms
  if (!visibleToAllDepts && departments.length > 0) {
    departments.forEach(dept => {
      io!.to(`projects:${collegeId}:${dept}`).emit('project-update', event);
    });
  }

  console.log(`Emitted project update to college ${collegeId}, departments: ${departments.join(', ')}`);
}

// Emit application updates to faculty
export function emitApplicationUpdate(facultyUserId: string, event: ApplicationUpdateEvent): void {
  if (!io) return;

  io!.to(`faculty:${facultyUserId}:applications`).emit('application-update', event);
  console.log(`Emitted application update to faculty ${facultyUserId}`);
}

// Emit real-time notifications
export function emitNotification(userId: string, notification: any): void {
  if (!io) return;

  // The null check above ensures io is not null at this point
  io!.to(`user:${userId}`).emit('notification', notification);
  console.log(`Emitted notification to user ${userId}`);
}
