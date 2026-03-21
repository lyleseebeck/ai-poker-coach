export const MAX_FEEDBACK_ATTACHMENTS = 3;
export const MAX_FEEDBACK_IMAGE_DIMENSION_PX = 1600;
export const TARGET_FEEDBACK_ATTACHMENT_BYTES = 700 * 1024;

const MIN_FEEDBACK_IMAGE_DIMENSION_PX = 600;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const EXTENSION_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function toSafeFilename(value) {
  const base = String(value || 'screenshot')
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'screenshot';
}

function getFileExtension(filename) {
  const match = /\.([a-z0-9]+)$/i.exec(String(filename || ''));
  return match ? match[1].toLowerCase() : '';
}

function stripFileExtension(filename) {
  return String(filename || '').replace(/\.[a-z0-9]+$/i, '');
}

function getImageOutputType(sourceType) {
  return sourceType === 'image/webp' ? 'image/webp' : 'image/jpeg';
}

function scaleDimensions(width, height, maxDimension) {
  const safeWidth = Math.max(1, Math.round(Number(width) || 1));
  const safeHeight = Math.max(1, Math.round(Number(height) || 1));
  const longestEdge = Math.max(safeWidth, safeHeight);
  if (longestEdge <= maxDimension) {
    return { width: safeWidth, height: safeHeight };
  }

  const scale = maxDimension / longestEdge;
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read screenshot.'));
    reader.readAsDataURL(blob);
  });
}

async function blobToBase64(blob) {
  const dataUrl = await readBlobAsDataUrl(blob);
  const commaIndex = dataUrl.indexOf(',');
  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
}

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that screenshot. Try another image file.'));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error('Could not prepare that screenshot for upload.'));
      },
      type,
      quality
    );
  });
}

export function estimateBase64DecodedBytes(base64) {
  const value = String(base64 || '').trim();
  if (!value) return 0;
  const paddingMatch = value.match(/=+$/);
  const paddingLength = paddingMatch ? paddingMatch[0].length : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - paddingLength);
}

export function normalizeAttachmentFilename(filename, contentType) {
  const safeType = ACCEPTED_TYPES.includes(contentType) ? contentType : 'image/jpeg';
  const nextExtension = EXTENSION_BY_TYPE[safeType] || 'jpg';
  const baseName = toSafeFilename(stripFileExtension(filename) || 'screenshot');
  const currentExtension = getFileExtension(filename);
  if (currentExtension === nextExtension) {
    return `${baseName}.${currentExtension}`;
  }
  return `${baseName}.${nextExtension}`;
}

export function validateFeedbackFiles(files, existingCount = 0) {
  const list = Array.from(files || []);
  if (existingCount + list.length > MAX_FEEDBACK_ATTACHMENTS) {
    throw new Error(`You can attach up to ${MAX_FEEDBACK_ATTACHMENTS} screenshots.`);
  }

  for (const file of list) {
    const type = String(file?.type || '').toLowerCase();
    if (!ACCEPTED_TYPES.includes(type)) {
      throw new Error('Screenshots must be PNG, JPG, or WebP images.');
    }
  }

  return list;
}

export async function compressFeedbackImage(
  file,
  {
    targetBytes = TARGET_FEEDBACK_ATTACHMENT_BYTES,
    maxDimension = MAX_FEEDBACK_IMAGE_DIMENSION_PX,
  } = {}
) {
  validateFeedbackFiles([file]);

  const image = await loadImageFromBlob(file);
  const outputType = getImageOutputType(file.type);
  let { width, height } = scaleDimensions(image.naturalWidth || image.width, image.naturalHeight || image.height, maxDimension);
  let bestBlob = null;
  const qualities = [0.82, 0.74, 0.66, 0.58, 0.5];

  while (width >= MIN_FEEDBACK_IMAGE_DIMENSION_PX || height >= MIN_FEEDBACK_IMAGE_DIMENSION_PX) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Your browser could not prepare this screenshot for upload.');
    }

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    for (const quality of qualities) {
      const blob = await canvasToBlob(canvas, outputType, quality);
      if (!bestBlob || blob.size < bestBlob.size) {
        bestBlob = blob;
      }
      if (blob.size <= targetBytes) {
        return {
          filename: normalizeAttachmentFilename(file.name, outputType),
          contentType: outputType,
          contentBase64: await blobToBase64(blob),
          sizeBytes: blob.size,
        };
      }
    }

    width = Math.max(Math.round(width * 0.85), MIN_FEEDBACK_IMAGE_DIMENSION_PX);
    height = Math.max(Math.round(height * 0.85), MIN_FEEDBACK_IMAGE_DIMENSION_PX);

    if (width === MIN_FEEDBACK_IMAGE_DIMENSION_PX && height === MIN_FEEDBACK_IMAGE_DIMENSION_PX) {
      break;
    }
  }

  if (bestBlob && bestBlob.size <= targetBytes) {
    return {
      filename: normalizeAttachmentFilename(file.name, outputType),
      contentType: outputType,
      contentBase64: await blobToBase64(bestBlob),
      sizeBytes: bestBlob.size,
    };
  }

  throw new Error(`"${file.name}" is still too large after optimization. Try a smaller screenshot.`);
}

export async function compressFeedbackFiles(files, options = {}) {
  const list = validateFeedbackFiles(files);
  const attachments = [];
  for (const file of list) {
    attachments.push(await compressFeedbackImage(file, options));
  }
  return attachments;
}

export const ACCEPTED_FEEDBACK_IMAGE_TYPES = ACCEPTED_TYPES;
