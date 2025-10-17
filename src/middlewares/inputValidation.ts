// Enhanced Input Validation Middleware
// Provides comprehensive validation beyond basic JSON Schema

import { FastifyRequest, FastifyReply } from "fastify";
import { formatValidationError } from "./responseFormatter";

// Common validation patterns
export const ValidationPatterns = {
  // UUID pattern
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  
  // Email pattern (basic)
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  
  // Safe filename pattern (no dangerous characters)
  safeFilename: /^[^<>:"/\\|?*\x00-\x1f]+$/,
  
  // URL pattern
  url: /^https?:\/\/.+/,
  
  // Department code pattern
  departmentCode: /^[A-Z]{2,6}$/,
  
  // College ID pattern
  collegeId: /^[0-9]+$/,
  
  // Skill/tag pattern (alphanumeric with spaces, hyphens, underscores)
  skillTag: /^[a-zA-Z0-9\s\-_]+$/
};

// Sanitization functions
export const Sanitizers = {
  // Remove HTML tags and dangerous characters
  sanitizeText: (text: string): string => {
    return text
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/[<>]/g, '') // Remove angle brackets
      .trim();
  },

  // Sanitize filename
  sanitizeFilename: (filename: string): string => {
    return filename
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '') // Remove dangerous characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .substring(0, 255); // Limit length
  },

  // Sanitize array of strings
  sanitizeStringArray: (arr: string[]): string[] => {
    return arr
      .filter(item => typeof item === 'string' && item.trim().length > 0)
      .map(item => Sanitizers.sanitizeText(item))
      .slice(0, 50); // Limit array size
  },

  // Normalize department codes
  normalizeDepartment: (dept: string): string => {
    return dept.toUpperCase().trim();
  }
};

// Custom validation functions
export const CustomValidators = {
  // Validate project deadline (must be in future)
  validateDeadline: (deadline: string): boolean => {
    const deadlineDate = new Date(deadline);
    const now = new Date();
    return deadlineDate > now;
  },

  // Validate max students count based on project type
  validateMaxStudents: (maxStudents: number, projectType: string): boolean => {
    const limits = {
      'PROJECT': 10,
      'RESEARCH': 5,
      'PAPER_PUBLISH': 3,
      'OTHER': 8
    };
    
    const limit = (limits as any)[projectType] || 10;
    return maxStudents >= 1 && maxStudents <= limit;
  },

  // Validate skills array
  validateSkills: (skills: string[]): boolean => {
    if (!Array.isArray(skills) || skills.length > 20) return false;
    
    return skills.every(skill => 
      typeof skill === 'string' && 
      skill.length >= 2 && 
      skill.length <= 50 &&
      ValidationPatterns.skillTag.test(skill)
    );
  },

  // Validate departments array
  validateDepartments: (departments: string[]): boolean => {
    if (!Array.isArray(departments) || departments.length > 10) return false;
    
    return departments.every(dept => 
      typeof dept === 'string' && 
      ValidationPatterns.departmentCode.test(dept)
    );
  },

  // Validate file size and type
  validateFile: (fileSize: number, fileType: string, fileName: string): { valid: boolean; error?: string } => {
    // File size validation (50MB max)
    if (fileSize > 52428800) {
      return { valid: false, error: "File size exceeds 50MB limit" };
    }

    // File type validation
    const allowedTypes = [
      // Images
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
      // Documents
      'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain', 'text/csv',
      // Archives
      'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed',
      // Code files
      'text/javascript', 'text/css', 'text/html', 'application/json',
      'text/x-python', 'text/x-java-source', 'text/x-c', 'text/x-c++src'
    ];

    if (!allowedTypes.includes(fileType)) {
      return { valid: false, error: "File type not allowed" };
    }

    // Dangerous file extensions
    const dangerousExtensions = ['.exe', '.bat', '.cmd', '.scr', '.pif', '.com', '.jar', '.vbs', '.js', '.ps1'];
    const fileExtension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
    
    if (dangerousExtensions.includes(fileExtension)) {
      return { valid: false, error: "File extension not allowed for security reasons" };
    }

    return { valid: true };
  }
};

// Enhanced validation middleware factory
export function createValidationMiddleware(customValidation?: (body: any) => { valid: boolean; errors: string[] }) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      
      if (!body) {
        return reply.badRequest("Request body is required");
      }

      // Apply sanitization
      if (body.title && typeof body.title === 'string') {
        body.title = Sanitizers.sanitizeText(body.title);
      }

      if (body.description && typeof body.description === 'string') {
        body.description = Sanitizers.sanitizeText(body.description);
      }

      if (body.message && typeof body.message === 'string') {
        body.message = Sanitizers.sanitizeText(body.message);
      }

      if (body.skills && Array.isArray(body.skills)) {
        body.skills = Sanitizers.sanitizeStringArray(body.skills);
      }

      if (body.tags && Array.isArray(body.tags)) {
        body.tags = Sanitizers.sanitizeStringArray(body.tags);
      }

      if (body.requirements && Array.isArray(body.requirements)) {
        body.requirements = Sanitizers.sanitizeStringArray(body.requirements);
      }

      if (body.outcomes && Array.isArray(body.outcomes)) {
        body.outcomes = Sanitizers.sanitizeStringArray(body.outcomes);
      }

      if (body.departments && Array.isArray(body.departments)) {
        body.departments = body.departments.map((dept: string) => Sanitizers.normalizeDepartment(dept));
      }

      if (body.fileName && typeof body.fileName === 'string') {
        body.fileName = Sanitizers.sanitizeFilename(body.fileName);
      }

      // Apply custom validation if provided
      if (customValidation) {
        const validation = customValidation(body);
        if (!validation.valid) {
          return reply.unprocessableEntity("Validation failed", validation.errors.join(', '));
        }
      }

      // Update request body with sanitized data
      request.body = body;
      
    } catch (error) {
      console.error("Validation middleware error:", error);
      return reply.internalError("Validation processing failed");
    }
  };
}

// Project-specific validation middleware
export const projectValidationMiddleware = createValidationMiddleware((body) => {
  const errors: string[] = [];

  // Validate deadline
  if (body.deadline && !CustomValidators.validateDeadline(body.deadline)) {
    errors.push("Deadline must be in the future");
  }

  // Validate max students
  if (body.maxStudents && body.projectType && !CustomValidators.validateMaxStudents(body.maxStudents, body.projectType)) {
    errors.push(`Max students exceeds limit for ${body.projectType} projects`);
  }

  // Validate skills
  if (body.skills && !CustomValidators.validateSkills(body.skills)) {
    errors.push("Invalid skills format or too many skills");
  }

  // Validate departments
  if (body.departments && !CustomValidators.validateDepartments(body.departments)) {
    errors.push("Invalid department codes");
  }

  return { valid: errors.length === 0, errors };
});

// File upload validation middleware
export const fileValidationMiddleware = createValidationMiddleware((body) => {
  const errors: string[] = [];

  if (body.fileSize && body.fileType && body.fileName) {
    const validation = CustomValidators.validateFile(body.fileSize, body.fileType, body.fileName);
    if (!validation.valid) {
      errors.push(validation.error!);
    }
  }

  return { valid: errors.length === 0, errors };
});

// Comment validation middleware
export const commentValidationMiddleware = createValidationMiddleware((body) => {
  const errors: string[] = [];

  // Validate comment length
  if (body.body && (body.body.length < 1 || body.body.length > 2000)) {
    errors.push("Comment must be between 1 and 2000 characters");
  }

  // Check for spam patterns
  if (body.body && /(.)\1{10,}/.test(body.body)) {
    errors.push("Comment contains spam patterns");
  }

  return { valid: errors.length === 0, errors };
});
