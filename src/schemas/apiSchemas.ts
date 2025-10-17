// Comprehensive API Schemas for Swagger Documentation
// This file contains all the JSON Schema definitions for API endpoints

export const commonSchemas = {
  // Standard response wrapper
  successResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      data: { type: 'object' },
      message: { type: 'string' }
    },
    required: ['success']
  },

  errorResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: false },
      error: { type: 'string' },
      details: { type: 'string' }
    },
    required: ['success', 'error']
  },

  // Pagination
  paginationQuery: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      sortBy: { type: 'string', enum: ['createdAt', 'updatedAt', 'title', 'deadline'] },
      sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'desc' }
    }
  },

  paginationResponse: {
    type: 'object',
    properties: {
      page: { type: 'integer' },
      limit: { type: 'integer' },
      total: { type: 'integer' },
      totalPages: { type: 'integer' },
      hasNext: { type: 'boolean' },
      hasPrev: { type: 'boolean' }
    }
  }
};

export const projectSchemas = {
  // Project entity
  project: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      title: { type: 'string', maxLength: 200 },
      description: { type: 'string', maxLength: 2000 },
      requirements: { 
        type: 'array', 
        items: { type: 'string' },
        description: 'List of project requirements'
      },
      outcomes: { 
        type: 'array', 
        items: { type: 'string' },
        description: 'Expected project outcomes'
      },
      projectType: { 
        type: 'string', 
        enum: ['PROJECT', 'RESEARCH', 'PAPER_PUBLISH', 'OTHER'] 
      },
      maxStudents: { type: 'integer', minimum: 1, maximum: 20 },
      deadline: { type: 'string', format: 'date-time' },
      departments: { 
        type: 'array', 
        items: { type: 'string' },
        description: 'Target departments'
      },
      visibleToAllDepts: { type: 'boolean', default: false },
      skills: { 
        type: 'array', 
        items: { type: 'string' },
        description: 'Required skills'
      },
      tags: { 
        type: 'array', 
        items: { type: 'string' },
        description: 'Project tags'
      },
      authorId: { type: 'string' },
      authorName: { type: 'string' },
      authorDepartment: { type: 'string' },
      authorAvatar: { type: 'string', format: 'uri' },
      collegeId: { type: 'string' },
      moderationStatus: { 
        type: 'string', 
        enum: ['PENDING', 'APPROVED', 'REJECTED'] 
      },
      progressStatus: { 
        type: 'string', 
        enum: ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] 
      },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      archivedAt: { type: 'string', format: 'date-time', nullable: true }
    },
    required: ['id', 'title', 'description', 'projectType', 'maxStudents', 'deadline']
  },

  // Project creation request
  createProjectRequest: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: 'string', minLength: 1, maxLength: 2000 },
      requirements: { 
        type: 'array', 
        items: { type: 'string' },
        minItems: 0,
        default: []
      },
      outcomes: { 
        type: 'array', 
        items: { type: 'string' },
        minItems: 0,
        default: []
      },
      projectType: { 
        type: 'string', 
        enum: ['PROJECT', 'RESEARCH', 'PAPER_PUBLISH', 'OTHER'] 
      },
      maxStudents: { type: 'integer', minimum: 1, maximum: 20 },
      deadline: { type: 'string', format: 'date-time' },
      departments: { 
        type: 'array', 
        items: { type: 'string' } 
      },
      visibleToAllDepts: { type: 'boolean', default: false },
      skills: { 
        type: 'array', 
        items: { type: 'string' } 
      },
      tags: { 
        type: 'array', 
        items: { type: 'string' } 
      }
    },
    required: ['title', 'description', 'projectType', 'maxStudents', 'deadline']
  },

  // Project update request
  updateProjectRequest: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: 'string', minLength: 1, maxLength: 2000 },
      requirements: { 
        type: 'array', 
        items: { type: 'string' }
      },
      outcomes: { 
        type: 'array', 
        items: { type: 'string' }
      },
      maxStudents: { type: 'integer', minimum: 1, maximum: 20 },
      deadline: { type: 'string', format: 'date-time' },
      departments: { 
        type: 'array', 
        items: { type: 'string' } 
      },
      visibleToAllDepts: { type: 'boolean' },
      skills: { 
        type: 'array', 
        items: { type: 'string' } 
      },
      tags: { 
        type: 'array', 
        items: { type: 'string' } 
      },
      progressStatus: { 
        type: 'string', 
        enum: ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] 
      }
    }
  },

  // Project query parameters
  projectsQuery: {
    type: 'object',
    properties: {
      q: { type: 'string', description: 'Search query' },
      projectType: { 
        type: 'string', 
        enum: ['PROJECT', 'RESEARCH', 'PAPER_PUBLISH', 'OTHER'] 
      },
      department: { type: 'string' },
      skills: { type: 'string', description: 'Comma-separated skills' },
      tags: { type: 'string', description: 'Comma-separated tags' },
      status: { 
        type: 'string', 
        enum: ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] 
      },
      ...commonSchemas.paginationQuery.properties
    }
  }
};

export const applicationSchemas = {
  // Application entity
  application: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      projectId: { type: 'string', format: 'uuid' },
      studentId: { type: 'string' },
      studentName: { type: 'string' },
      studentDepartment: { type: 'string' },
      message: { type: 'string', maxLength: 1000, nullable: true },
      status: { 
        type: 'string', 
        enum: ['PENDING', 'ACCEPTED', 'REJECTED'] 
      },
      appliedAt: { type: 'string', format: 'date-time' },
      project: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          authorName: { type: 'string' },
          maxStudents: { type: 'integer' }
        }
      }
    },
    required: ['id', 'projectId', 'studentId', 'studentName', 'status']
  },

  // Application creation request
  createApplicationRequest: {
    type: 'object',
    properties: {
      message: { 
        type: 'string', 
        maxLength: 1000,
        description: 'Optional message to the project author'
      }
    }
  },

  // Application status update request
  updateApplicationStatusRequest: {
    type: 'object',
    properties: {
      status: { 
        type: 'string', 
        enum: ['ACCEPTED', 'REJECTED'],
        description: 'New application status'
      }
    },
    required: ['status']
  }
};

export const taskSchemas = {
  // Task entity
  task: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      title: { type: 'string', maxLength: 200 },
      projectId: { type: 'string', format: 'uuid' },
      assignedToId: { type: 'string', nullable: true },
      status: { 
        type: 'string', 
        enum: ['TODO', 'IN_PROGRESS', 'DONE'] 
      },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' }
    },
    required: ['id', 'title', 'projectId', 'status']
  },

  // Task creation request
  createTaskRequest: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      assignedToId: { 
        type: 'string',
        description: 'Optional user ID to assign task to'
      }
    },
    required: ['title']
  },

  // Task update request
  updateTaskRequest: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      assignedToId: { type: 'string' },
      status: { 
        type: 'string', 
        enum: ['TODO', 'IN_PROGRESS', 'DONE'] 
      }
    }
  }
};

export const attachmentSchemas = {
  // Attachment entity
  attachment: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      fileName: { type: 'string', maxLength: 255 },
      fileUrl: { type: 'string', format: 'uri' },
      fileType: { type: 'string' },
      fileSize: { type: 'integer', minimum: 0 },
      description: { type: 'string', maxLength: 500, nullable: true },
      projectId: { type: 'string', format: 'uuid' },
      uploaderId: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' }
    },
    required: ['id', 'fileName', 'fileUrl', 'fileType', 'projectId', 'uploaderId']
  },

  // Attachment upload request
  uploadAttachmentRequest: {
    type: 'object',
    properties: {
      fileName: { 
        type: 'string', 
        minLength: 1, 
        maxLength: 255,
        pattern: '^[^<>:"/\\|?*]+$',
        description: 'Valid filename without dangerous characters'
      },
      fileUrl: { 
        type: 'string', 
        format: 'uri',
        description: 'URL to the uploaded file'
      },
      fileType: { 
        type: 'string',
        description: 'MIME type of the file'
      },
      fileSize: { 
        type: 'integer', 
        minimum: 1, 
        maximum: 52428800,
        description: 'File size in bytes (max 50MB)'
      },
      description: { 
        type: 'string', 
        maxLength: 500,
        description: 'Optional file description'
      }
    },
    required: ['fileName', 'fileUrl', 'fileType']
  },

  // Attachment update request
  updateAttachmentRequest: {
    type: 'object',
    properties: {
      fileName: { 
        type: 'string', 
        minLength: 1, 
        maxLength: 255,
        pattern: '^[^<>:"/\\|?*]+$'
      }
    },
    required: ['fileName']
  }
};

export const commentSchemas = {
  // Comment entity
  comment: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      projectId: { type: 'string', format: 'uuid' },
      taskId: { type: 'string', format: 'uuid', nullable: true },
      authorId: { type: 'string' },
      authorName: { type: 'string' },
      body: { type: 'string', maxLength: 2000 },
      createdAt: { type: 'string', format: 'date-time' }
    },
    required: ['id', 'projectId', 'authorId', 'authorName', 'body']
  },

  // Comment creation request
  createCommentRequest: {
    type: 'object',
    properties: {
      body: { 
        type: 'string', 
        minLength: 1, 
        maxLength: 2000,
        description: 'Comment content'
      },
      taskId: { 
        type: 'string',
        description: 'Optional task ID for task-specific comments'
      }
    },
    required: ['body']
  }
};

export const healthSchemas = {
  // Health check response
  healthResponse: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['ok', 'error'] },
      service: { type: 'string' },
      timestamp: { type: 'string', format: 'date-time' },
      uptime: { type: 'number' },
      version: { type: 'string' }
    },
    required: ['status', 'service', 'timestamp']
  },

  // Detailed health response
  detailedHealthResponse: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['healthy', 'unhealthy', 'degraded'] },
      service: { type: 'string' },
      timestamp: { type: 'string', format: 'date-time' },
      checks: {
        type: 'object',
        properties: {
          database: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              responseTime: { type: 'number' },
              error: { type: 'string' }
            }
          },
          cache: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              responseTime: { type: 'number' },
              error: { type: 'string' }
            }
          },
          websocket: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              connections: { type: 'number' },
              uptime: { type: 'number' }
            }
          },
          external: {
            type: 'object',
            properties: {
              authService: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  responseTime: { type: 'number' }
                }
              }
            }
          }
        }
      }
    }
  }
};

// Parameter schemas
export const parameterSchemas = {
  projectId: {
    type: 'object',
    properties: {
      id: { 
        type: 'string', 
        format: 'uuid',
        description: 'Project ID'
      }
    },
    required: ['id']
  },

  applicationId: {
    type: 'object',
    properties: {
      id: { 
        type: 'string', 
        format: 'uuid',
        description: 'Application ID'
      }
    },
    required: ['id']
  },

  taskId: {
    type: 'object',
    properties: {
      id: { 
        type: 'string', 
        format: 'uuid',
        description: 'Task ID'
      }
    },
    required: ['id']
  },

  attachmentId: {
    type: 'object',
    properties: {
      id: { 
        type: 'string', 
        format: 'uuid',
        description: 'Attachment ID'
      }
    },
    required: ['id']
  }
};
