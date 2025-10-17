// E2EE Key Management Routes
// Phase 1 Implementation - Non-disruptive key management

import { FastifyInstance } from "fastify";
import { requireFacultyOrStudent } from "../middlewares/unifiedAuth";
import { prisma } from "../db";

export default async function keyRoutes(app: FastifyInstance) {
  
  // Upload user's public key (per-device)
  app.post("/v1/profile/keys", {
    schema: {
      tags: ["e2ee"],
      summary: "Upload user public key for E2EE",
      body: {
        type: 'object',
        properties: {
          publicKey: { 
            type: 'string', 
            pattern: '^[A-Za-z0-9+/=]+$',
            description: 'Base64 encoded X25519 public key'
          },
          deviceId: { 
            type: 'string', 
            minLength: 1, 
            maxLength: 100,
            description: 'Unique device identifier'
          },
          keyType: { 
            type: 'string', 
            enum: ['x25519'], 
            default: 'x25519' 
          }
        },
        required: ['publicKey', 'deviceId']
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (req: any, reply: any) => {
    try {
      const user = await requireFacultyOrStudent(req);
      const { publicKey, deviceId, keyType = 'x25519' } = req.body;

      // Validate key format (basic validation)
      if (!isValidBase64(publicKey) || publicKey.length !== 44) {
        return reply.status(400).send({
          success: false,
          error: "Invalid public key format"
        });
      }

      // Upsert public key (replace if exists for same device)
      await prisma.userPublicKey.upsert({
        where: {
          userId_deviceId: {
            userId: user.sub,
            deviceId
          }
        },
        create: {
          userId: user.sub,
          deviceId,
          publicKey,
          keyType,
          createdAt: new Date()
        },
        update: {
          publicKey,
          keyType,
          updatedAt: new Date()
        }
      });

      return reply.status(201).send({
        success: true,
        message: "Public key registered successfully"
      });

    } catch (error) {
      console.error("Error uploading public key:", error);
      return reply.status(500).send({
        success: false,
        error: "Failed to register public key"
      });
    }
  });

  // Get user's public keys
  app.get("/v1/profile/:userId/keys", {
    schema: {
      tags: ["e2ee"],
      summary: "Get user's public keys",
      params: {
        type: 'object',
        properties: {
          userId: { type: 'string' }
        },
        required: ['userId']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                keys: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      deviceId: { type: 'string' },
                      publicKey: { type: 'string' },
                      keyType: { type: 'string' },
                      createdAt: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }, async (req: any, reply: any) => {
    try {
      const { userId } = req.params;
      
      // Get all public keys for user
      const keys = await prisma.userPublicKey.findMany({
        where: { userId },
        select: {
          deviceId: true,
          publicKey: true,
          keyType: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' }
      });

      return reply.send({
        success: true,
        data: { keys }
      });

    } catch (error) {
      console.error("Error fetching public keys:", error);
      return reply.status(500).send({
        success: false,
        error: "Failed to fetch public keys"
      });
    }
  });

  // Initialize conversation keys for a project
  app.post("/v1/conversations/:projectId/keys", {
    schema: {
      tags: ["e2ee"],
      summary: "Initialize E2EE for project conversation",
      params: {
        type: 'object',
        properties: {
          projectId: { type: 'string' }
        },
        required: ['projectId']
      },
      body: {
        type: 'object',
        properties: {
          encryptedKeyBlobs: {
            type: 'object',
            description: 'Encrypted symmetric key for each participant',
            additionalProperties: { type: 'string' }
          }
        },
        required: ['encryptedKeyBlobs']
      }
    }
  }, async (req: any, reply: any) => {
    try {
      const user = await requireFacultyOrStudent(req);
      const { projectId } = req.params;
      const { encryptedKeyBlobs } = req.body;

      // Verify user can access project
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          applications: {
            where: { 
              status: 'ACCEPTED',
              studentId: user.sub 
            }
          }
        }
      });

      if (!project) {
        return reply.status(404).send({
          success: false,
          error: "Project not found"
        });
      }

      const isAuthor = project.authorId === user.sub;
      const isAcceptedMember = project.applications.length > 0;

      if (!isAuthor && !isAcceptedMember) {
        return reply.status(403).send({
          success: false,
          error: "Access denied"
        });
      }

      // Create or update conversation keys
      await prisma.conversationKey.upsert({
        where: { projectId },
        create: {
          projectId,
          encryptedKeyBlobs,
          isEncrypted: true,
          createdAt: new Date()
        },
        update: {
          encryptedKeyBlobs,
          rotatedAt: new Date()
        }
      });

      return reply.status(201).send({
        success: true,
        message: "Conversation encryption initialized"
      });

    } catch (error) {
      console.error("Error initializing conversation keys:", error);
      return reply.status(500).send({
        success: false,
        error: "Failed to initialize encryption"
      });
    }
  });

  // Get conversation keys for a project
  app.get("/v1/conversations/:projectId/keys", {
    schema: {
      tags: ["e2ee"],
      summary: "Get encrypted conversation keys",
      params: {
        type: 'object',
        properties: {
          projectId: { type: 'string' }
        },
        required: ['projectId']
      }
    }
  }, async (req: any, reply: any) => {
    try {
      const user = await requireFacultyOrStudent(req);
      const { projectId } = req.params;

      // Verify access (same as above)
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          applications: {
            where: { 
              status: 'ACCEPTED',
              studentId: user.sub 
            }
          }
        }
      });

      if (!project) {
        return reply.status(404).send({
          success: false,
          error: "Project not found"
        });
      }

      const isAuthor = project.authorId === user.sub;
      const isAcceptedMember = project.applications.length > 0;

      if (!isAuthor && !isAcceptedMember) {
        return reply.status(403).send({
          success: false,
          error: "Access denied"
        });
      }

      // Get conversation keys
      const conversationKeys = await prisma.conversationKey.findUnique({
        where: { projectId },
        select: {
          encryptedKeyBlobs: true,
          isEncrypted: true,
          createdAt: true,
          rotatedAt: true
        }
      });

      if (!conversationKeys) {
        return reply.status(404).send({
          success: false,
          error: "Conversation not encrypted"
        });
      }

      // Return only the user's encrypted key blob
      const userKeyBlob = (conversationKeys.encryptedKeyBlobs as any)[user.sub];

      return reply.send({
        success: true,
        data: {
          encryptedKeyBlob: userKeyBlob,
          isEncrypted: conversationKeys.isEncrypted,
          createdAt: conversationKeys.createdAt,
          rotatedAt: conversationKeys.rotatedAt
        }
      });

    } catch (error) {
      console.error("Error fetching conversation keys:", error);
      return reply.status(500).send({
        success: false,
        error: "Failed to fetch conversation keys"
      });
    }
  });
}

// Helper function to validate base64
function isValidBase64(str: string): boolean {
  try {
    return btoa(atob(str)) === str;
  } catch (err) {
    return false;
  }
}
