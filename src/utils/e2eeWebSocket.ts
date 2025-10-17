// Enhanced WebSocket with E2EE Message Support
// Phase 3: Add encrypted message transport while maintaining backward compatibility

import { Server as SocketIOServer, Socket } from 'socket.io';
import { SocketUserData } from './enhancedWebSocket';
import { prisma } from '../db';
import { FeatureFlags, MessageValidator, CryptoError } from './crypto';

// Enhanced message interfaces for E2EE
export interface EncryptedMessage {
  ciphertext: string;
  nonce: string;
  senderId: string;
  projectId: string;
  taskId?: string;
  messageType: 'text' | 'file' | 'system';
  timestamp: string;
  signature?: string; // Optional message signature
}

export interface PlaintextMessage {
  content: string;
  senderId: string;
  projectId: string;
  taskId?: string;
  messageType: 'text' | 'file' | 'system';
  timestamp: string;
}

export interface MessageDeliveryReceipt {
  messageId: string;
  recipientId: string;
  deliveredAt: string;
  status: 'delivered' | 'read';
}

export interface TypingIndicator {
  userId: string;
  projectId: string;
  isTyping: boolean;
  timestamp: string;
}

// Enhanced WebSocket event handlers for E2EE
export function setupE2EEWebSocketHandlers(io: SocketIOServer) {
  
  io.on('connection', (socket: Socket) => {
    const userData: SocketUserData = socket.data;
    
    // Handle encrypted message sending
    socket.on('send-encrypted-message', async (data: EncryptedMessage, callback) => {
      try {
        // Validate message structure
        if (!MessageValidator.validateEncryptedMessage(data)) {
          return callback?.({ success: false, error: 'Invalid message format' });
        }

        // Check if E2EE is enabled for this project
        const isE2EEEnabled = await FeatureFlags.isE2EEEnabled();
        if (!isE2EEEnabled) {
          return callback?.({ success: false, error: 'E2EE not enabled' });
        }

        // Verify user can access project
        const hasAccess = await verifyProjectAccess(userData.userId, data.projectId);
        if (!hasAccess) {
          return callback?.({ success: false, error: 'Access denied' });
        }

        // Check if conversation is encrypted
        const conversationKey = await (prisma as any).conversationKey?.findUnique({
          where: { projectId: data.projectId }
        });

        if (!conversationKey || !conversationKey.isEncrypted) {
          return callback?.({ success: false, error: 'Conversation not encrypted' });
        }

        // Store encrypted message in database
        const messageId = await storeEncryptedMessage(data);

        // Broadcast to project room
        socket.to(`project:${data.projectId}`).emit('encrypted-message', {
          ...data,
          messageId,
          deliveredAt: new Date().toISOString()
        });

        // Send delivery confirmation
        callback?.({ 
          success: true, 
          messageId,
          deliveredAt: new Date().toISOString()
        });

        console.log(`📧 Encrypted message sent in project ${data.projectId} by ${userData.userId}`);

      } catch (error) {
        console.error('Error handling encrypted message:', error);
        callback?.({ 
          success: false, 
          error: error instanceof CryptoError ? error.message : 'Message delivery failed' 
        });
      }
    });

    // Handle plaintext message sending (backward compatibility)
    socket.on('send-message', async (data: PlaintextMessage, callback) => {
      try {
        // Check if conversation is encrypted - if so, reject plaintext
        const conversationKey = await (prisma as any).conversationKey?.findUnique({
          where: { projectId: data.projectId }
        });

        if (conversationKey?.isEncrypted) {
          return callback?.({ 
            success: false, 
            error: 'This conversation requires encryption' 
          });
        }

        // Verify project access
        const hasAccess = await verifyProjectAccess(userData.userId, data.projectId);
        if (!hasAccess) {
          return callback?.({ success: false, error: 'Access denied' });
        }

        // Store plaintext message
        const messageId = await storePlaintextMessage(data);

        // Broadcast to project room
        socket.to(`project:${data.projectId}`).emit('message', {
          ...data,
          messageId,
          deliveredAt: new Date().toISOString()
        });

        callback?.({ 
          success: true, 
          messageId,
          deliveredAt: new Date().toISOString()
        });

        console.log(`💬 Plaintext message sent in project ${data.projectId} by ${userData.userId}`);

      } catch (error) {
        console.error('Error handling plaintext message:', error);
        callback?.({ success: false, error: 'Message delivery failed' });
      }
    });

    // Handle typing indicators
    socket.on('typing-start', async (data: { projectId: string; taskId?: string }) => {
      try {
        const hasAccess = await verifyProjectAccess(userData.userId, data.projectId);
        if (!hasAccess) return;

        const typingData: TypingIndicator = {
          userId: userData.userId,
          projectId: data.projectId,
          isTyping: true,
          timestamp: new Date().toISOString()
        };

        socket.to(`project:${data.projectId}`).emit('user-typing', typingData);
        
      } catch (error) {
        console.error('Error handling typing start:', error);
      }
    });

    socket.on('typing-stop', async (data: { projectId: string; taskId?: string }) => {
      try {
        const hasAccess = await verifyProjectAccess(userData.userId, data.projectId);
        if (!hasAccess) return;

        const typingData: TypingIndicator = {
          userId: userData.userId,
          projectId: data.projectId,
          isTyping: false,
          timestamp: new Date().toISOString()
        };

        socket.to(`project:${data.projectId}`).emit('user-typing', typingData);
        
      } catch (error) {
        console.error('Error handling typing stop:', error);
      }
    });

    // Handle message delivery receipts
    socket.on('message-delivered', async (data: { messageId: string; projectId: string }) => {
      try {
        const hasAccess = await verifyProjectAccess(userData.userId, data.projectId);
        if (!hasAccess) return;

        const receipt: MessageDeliveryReceipt = {
          messageId: data.messageId,
          recipientId: userData.userId,
          deliveredAt: new Date().toISOString(),
          status: 'delivered'
        };

        // Send receipt to message sender
        socket.to(`project:${data.projectId}`).emit('delivery-receipt', receipt);
        
      } catch (error) {
        console.error('Error handling delivery receipt:', error);
      }
    });

    socket.on('message-read', async (data: { messageId: string; projectId: string }) => {
      try {
        const hasAccess = await verifyProjectAccess(userData.userId, data.projectId);
        if (!hasAccess) return;

        const receipt: MessageDeliveryReceipt = {
          messageId: data.messageId,
          recipientId: userData.userId,
          deliveredAt: new Date().toISOString(),
          status: 'read'
        };

        // Send receipt to message sender
        socket.to(`project:${data.projectId}`).emit('delivery-receipt', receipt);
        
      } catch (error) {
        console.error('Error handling read receipt:', error);
      }
    });

    // Handle conversation encryption initialization
    socket.on('init-encryption', async (data: { projectId: string }, callback) => {
      try {
        const hasAccess = await verifyProjectAccess(userData.userId, data.projectId);
        if (!hasAccess) {
          return callback?.({ success: false, error: 'Access denied' });
        }

        // Check if user is project author (only author can initialize encryption)
        const project = await prisma.project.findUnique({
          where: { id: data.projectId },
          select: { authorId: true }
        });

        if (!project || project.authorId !== userData.userId) {
          return callback?.({ 
            success: false, 
            error: 'Only project author can initialize encryption' 
          });
        }

        // Check if already encrypted
        const existingKey = await (prisma as any).conversationKey?.findUnique({
          where: { projectId: data.projectId }
        });

        if (existingKey) {
          return callback?.({ 
            success: false, 
            error: 'Conversation already encrypted' 
          });
        }

        // Notify project members about encryption initialization
        socket.to(`project:${data.projectId}`).emit('encryption-initialized', {
          projectId: data.projectId,
          initializedBy: userData.userId,
          timestamp: new Date().toISOString()
        });

        callback?.({ success: true });
        
      } catch (error) {
        console.error('Error initializing encryption:', error);
        callback?.({ success: false, error: 'Failed to initialize encryption' });
      }
    });

    // Handle presence updates
    socket.on('update-presence', async (data: { projectId: string; status: 'online' | 'away' | 'busy' }) => {
      try {
        const hasAccess = await verifyProjectAccess(userData.userId, data.projectId);
        if (!hasAccess) return;

        socket.to(`project:${data.projectId}`).emit('user-presence', {
          userId: userData.userId,
          projectId: data.projectId,
          status: data.status,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        console.error('Error updating presence:', error);
      }
    });
  });
}

// Helper function to verify project access
async function verifyProjectAccess(userId: string, projectId: string): Promise<boolean> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        applications: {
          where: { 
            studentId: userId,
            status: 'ACCEPTED'
          }
        }
      }
    });

    if (!project) return false;

    // Check if user is project author or accepted member
    const isAuthor = project.authorId === userId;
    const isAcceptedMember = project.applications.length > 0;

    return isAuthor || isAcceptedMember;
    
  } catch (error) {
    console.error('Error verifying project access:', error);
    return false;
  }
}

// Store encrypted message in database
async function storeEncryptedMessage(message: EncryptedMessage): Promise<string> {
  const comment = await (prisma.comment as any).create({
    data: {
      projectId: message.projectId,
      taskId: message.taskId || null,
      authorId: message.senderId,
      authorName: 'Encrypted User', // Don't store real name for E2EE
      body: '[Encrypted Message]', // Placeholder for backward compatibility
      ciphertext: message.ciphertext,
      nonce: message.nonce,
      isEncrypted: true,
      messageSignature: message.signature
    }
  });

  return comment.id;
}

// Store plaintext message in database
async function storePlaintextMessage(message: PlaintextMessage): Promise<string> {
  // Get user name from auth system or cache
  const userName = await getUserName(message.senderId);
  
  const comment = await (prisma.comment as any).create({
    data: {
      projectId: message.projectId,
      taskId: message.taskId || null,
      authorId: message.senderId,
      authorName: userName,
      body: message.content,
      isEncrypted: false
    }
  });

  return comment.id;
}

// Helper to get user name (implement based on your auth system)
async function getUserName(userId: string): Promise<string> {
  // This should integrate with your auth/profile service
  // For now, return a placeholder
  return `User ${userId.substring(0, 8)}`;
}

// Message history retrieval with E2EE support
export async function getMessageHistory(
  projectId: string, 
  userId: string, 
  limit: number = 50, 
  before?: string
): Promise<{
  messages: (EncryptedMessage | PlaintextMessage)[];
  hasMore: boolean;
}> {
  try {
    // Verify access
    const hasAccess = await verifyProjectAccess(userId, projectId);
    if (!hasAccess) {
      throw new Error('Access denied');
    }

    // Get messages from database
    const whereClause: any = { projectId };
    if (before) {
      whereClause.createdAt = { lt: new Date(before) };
    }

    const comments = await (prisma.comment as any).findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: limit + 1, // Get one extra to check if there are more
      select: {
        id: true,
        authorId: true,
        authorName: true,
        body: true,
        ciphertext: true,
        nonce: true,
        isEncrypted: true,
        messageSignature: true,
        taskId: true,
        createdAt: true
      }
    });

    const hasMore = comments.length > limit;
    const messages = comments.slice(0, limit);

    // Convert to appropriate format
    const formattedMessages = messages.map((comment: any) => {
      if (comment.isEncrypted && comment.ciphertext && comment.nonce) {
        return {
          ciphertext: comment.ciphertext,
          nonce: comment.nonce,
          senderId: comment.authorId,
          projectId,
          taskId: comment.taskId || undefined,
          messageType: 'text' as const,
          timestamp: comment.createdAt.toISOString(),
          signature: comment.messageSignature || undefined
        } as EncryptedMessage;
      } else {
        return {
          content: comment.body,
          senderId: comment.authorId,
          projectId,
          taskId: comment.taskId || undefined,
          messageType: 'text' as const,
          timestamp: comment.createdAt.toISOString()
        } as PlaintextMessage;
      }
    });

    return {
      messages: formattedMessages,
      hasMore
    };

  } catch (error) {
    console.error('Error retrieving message history:', error);
    throw error;
  }
}
