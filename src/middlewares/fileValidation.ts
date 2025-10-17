import { FastifyRequest, FastifyReply } from "fastify";

// File validation configuration
export const FILE_VALIDATION_CONFIG = {
  // Maximum file size in bytes (50MB)
  maxFileSize: 50 * 1024 * 1024,
  
  // Allowed MIME types
  allowedMimeTypes: [
    // Images
    'image/jpeg',
    'image/jpg', 
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    
    // Archives
    'application/zip',
    'application/x-rar-compressed',
    'application/x-7z-compressed',
    
    // Code files
    'text/javascript',
    'text/html',
    'text/css',
    'application/json',
    'text/xml',
    'application/xml'
  ],
  
  // Allowed file extensions (as backup check)
  allowedExtensions: [
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.txt', '.csv', '.zip', '.rar', '.7z',
    '.js', '.html', '.css', '.json', '.xml'
  ],
  
  // Dangerous file extensions to explicitly block
  blockedExtensions: [
    '.exe', '.bat', '.cmd', '.com', '.scr', '.pif',
    '.vbs', '.js', '.jar', '.app', '.deb', '.pkg',
    '.dmg', '.iso', '.msi', '.dll', '.sys'
  ],
  
  // Maximum filename length
  maxFilenameLength: 255,
  
  // Virus scanning configuration (placeholder for future implementation)
  virusScanEnabled: false
};

/**
 * Validates file upload data
 */
export async function validateFileUpload(
  fileName: string, 
  fileUrl: string, 
  fileType: string,
  fileSize?: number
): Promise<{ isValid: boolean; error?: string }> {
  
  // Validate filename
  if (!fileName || fileName.trim().length === 0) {
    return { isValid: false, error: 'Filename is required' };
  }
  
  if (fileName.length > FILE_VALIDATION_CONFIG.maxFilenameLength) {
    return { isValid: false, error: `Filename too long (max ${FILE_VALIDATION_CONFIG.maxFilenameLength} characters)` };
  }
  
  // Check for dangerous characters in filename
  const dangerousChars = /[<>:"/\\|?*\x00-\x1f]/;
  if (dangerousChars.test(fileName)) {
    return { isValid: false, error: 'Filename contains invalid characters' };
  }
  
  // Validate file extension
  const fileExtension = getFileExtension(fileName).toLowerCase();
  
  if (FILE_VALIDATION_CONFIG.blockedExtensions.includes(fileExtension)) {
    return { isValid: false, error: 'File type not allowed for security reasons' };
  }
  
  if (!FILE_VALIDATION_CONFIG.allowedExtensions.includes(fileExtension)) {
    return { isValid: false, error: `File extension ${fileExtension} not allowed` };
  }
  
  // Validate MIME type
  if (!fileType || !FILE_VALIDATION_CONFIG.allowedMimeTypes.includes(fileType.toLowerCase())) {
    return { isValid: false, error: `File type ${fileType} not allowed` };
  }
  
  // Cross-check MIME type with file extension
  if (!isMimeTypeMatchingExtension(fileType, fileExtension)) {
    return { isValid: false, error: 'File type does not match file extension' };
  }
  
  // Validate file URL (basic check)
  if (!fileUrl || !isValidUrl(fileUrl)) {
    return { isValid: false, error: 'Invalid file URL' };
  }
  
  // Validate file size if provided
  if (fileSize !== undefined) {
    if (fileSize > FILE_VALIDATION_CONFIG.maxFileSize) {
      const maxSizeMB = FILE_VALIDATION_CONFIG.maxFileSize / (1024 * 1024);
      return { isValid: false, error: `File size exceeds maximum allowed size of ${maxSizeMB}MB` };
    }
    
    if (fileSize <= 0) {
      return { isValid: false, error: 'File size must be greater than 0' };
    }
  }
  
  // TODO: Implement virus scanning
  if (FILE_VALIDATION_CONFIG.virusScanEnabled) {
    const scanResult = await scanForViruses(fileUrl);
    if (!scanResult.clean) {
      return { isValid: false, error: 'File failed security scan' };
    }
  }
  
  return { isValid: true };
}

/**
 * Middleware for validating file upload requests
 */
export async function fileUploadValidationMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as any;
  
  if (!body) {
    return reply.code(400).send({
      success: false,
      error: 'Request body is required'
    });
  }
  
  const { fileName, fileUrl, fileType } = body;
  
  const validation = await validateFileUpload(fileName, fileUrl, fileType);
  
  if (!validation.isValid) {
    return reply.code(400).send({
      success: false,
      error: validation.error,
      code: 'FILE_VALIDATION_FAILED'
    });
  }
}

/**
 * Sanitizes filename for safe storage
 */
export function sanitizeFilename(filename: string): string {
  // Remove or replace dangerous characters
  let sanitized = filename
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') // Replace dangerous chars with underscore
    .replace(/\s+/g, '_') // Replace spaces with underscore
    .replace(/_{2,}/g, '_') // Replace multiple underscores with single
    .replace(/^_+|_+$/g, ''); // Remove leading/trailing underscores
  
  // Ensure filename is not empty after sanitization
  if (!sanitized) {
    sanitized = 'file';
  }
  
  // Ensure filename is not too long
  if (sanitized.length > FILE_VALIDATION_CONFIG.maxFilenameLength) {
    const ext = getFileExtension(sanitized);
    const nameWithoutExt = sanitized.substring(0, sanitized.lastIndexOf('.'));
    const maxNameLength = FILE_VALIDATION_CONFIG.maxFilenameLength - ext.length;
    sanitized = nameWithoutExt.substring(0, maxNameLength) + ext;
  }
  
  return sanitized;
}

// Helper functions
function getFileExtension(filename: string): string {
  const lastDotIndex = filename.lastIndexOf('.');
  return lastDotIndex === -1 ? '' : filename.substring(lastDotIndex);
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function isMimeTypeMatchingExtension(mimeType: string, extension: string): boolean {
  const mimeToExtMap: { [key: string]: string[] } = {
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/gif': ['.gif'],
    'image/webp': ['.webp'],
    'image/svg+xml': ['.svg'],
    'application/pdf': ['.pdf'],
    'application/msword': ['.doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    'text/plain': ['.txt'],
    'text/csv': ['.csv'],
    'application/json': ['.json'],
    'text/javascript': ['.js'],
    'text/html': ['.html'],
    'text/css': ['.css'],
    'application/zip': ['.zip'],
    'application/xml': ['.xml'],
    'text/xml': ['.xml']
  };
  
  const expectedExtensions = mimeToExtMap[mimeType.toLowerCase()];
  return expectedExtensions ? expectedExtensions.includes(extension.toLowerCase()) : true;
}

// Placeholder for virus scanning (to be implemented with actual antivirus service)
async function scanForViruses(fileUrl: string): Promise<{ clean: boolean; details?: string }> {
  // TODO: Implement actual virus scanning
  // This could integrate with services like:
  // - ClamAV
  // - VirusTotal API
  // - AWS GuardDuty
  // - Azure Defender
  
  return { clean: true };
}

// File type detection utilities
export const FILE_CATEGORIES = {
  IMAGE: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
  DOCUMENT: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  SPREADSHEET: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  PRESENTATION: ['application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  TEXT: ['text/plain', 'text/csv'],
  ARCHIVE: ['application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed'],
  CODE: ['text/javascript', 'text/html', 'text/css', 'application/json', 'text/xml', 'application/xml']
};

export function getFileCategory(mimeType: string): string {
  for (const [category, types] of Object.entries(FILE_CATEGORIES)) {
    if (types.includes(mimeType.toLowerCase())) {
      return category;
    }
  }
  return 'OTHER';
}
