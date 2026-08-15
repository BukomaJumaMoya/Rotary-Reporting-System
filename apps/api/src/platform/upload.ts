import type { Request } from 'express';
import busboy from 'busboy';
import { AppError, ErrorCode } from './errors.js';

/**
 * Multipart uploads.
 *
 * **Content type is decided by MAGIC BYTES, never by the extension and never by the
 * `Content-Type` the client sent.** Both are attacker-supplied strings. A file called
 * `photo.jpg` that is actually an HTML document, served back later from a domain that holds
 * a session cookie, is stored XSS; a file whose declared type is `image/png` and whose bytes
 * are a 900MB zip is a memory exhaustion. What the bytes say is the only thing that is true
 * about them.
 *
 * The size cap is enforced WHILE READING, not after. Checking `Content-Length` trusts a
 * header, and checking the buffer afterwards means the buffer already exists.
 */

/** What the system accepts. Deliberately short: photographs of activities, and nothing else. */
const IMAGE_SIGNATURES: {
  extension: string;
  contentType: string;
  matches: (b: Buffer) => boolean;
}[] = [
  {
    extension: 'jpg',
    contentType: 'image/jpeg',
    matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    extension: 'png',
    contentType: 'image/png',
    matches: (b) =>
      b.length > 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    extension: 'webp',
    contentType: 'image/webp',
    // RIFF....WEBP — the container is RIFF and the form is named eight bytes in.
    matches: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    extension: 'heic',
    contentType: 'image/heic',
    // An iPhone's default. Rejecting it would reject the camera most members carry.
    matches: (b) =>
      b.length > 12 &&
      b.subarray(4, 8).toString('ascii') === 'ftyp' &&
      ['heic', 'heix', 'hevc', 'mif1'].includes(b.subarray(8, 12).toString('ascii')),
  },
];

export interface SniffedType {
  extension: string;
  contentType: string;
}

/** What the bytes actually are, or undefined for anything not on the list. */
export function sniffImage(body: Buffer): SniffedType | undefined {
  const found = IMAGE_SIGNATURES.find((signature) => signature.matches(body));
  return found ? { extension: found.extension, contentType: found.contentType } : undefined;
}

export interface UploadedFile {
  body: Buffer;
  /** The client's filename, kept for a caption and NEVER for a storage key. */
  reportedName: string;
  size: number;
}

export interface ParsedUpload {
  file: UploadedFile | undefined;
  fields: Record<string, string>;
}

/** 10MB. A modern phone photograph is 2–5MB; twice that is generous and still bounded. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Reads ONE file and any accompanying text fields from a multipart request.
 *
 * Buffered in memory rather than spooled to disk: the cap is 10MB, the application
 * filesystem is ephemeral anyway (ADR-007), and a temporary file is a temporary file
 * somebody has to remember to delete on every error path.
 */
export async function parseUpload(req: Request): Promise<ParsedUpload> {
  return new Promise<ParsedUpload>((resolve, reject) => {
    let parser: busboy.Busboy;
    try {
      parser = busboy({
        headers: req.headers,
        limits: {
          files: 1,
          fileSize: MAX_UPLOAD_BYTES,
          fields: 20,
          fieldSize: 4096,
        },
      });
    } catch {
      reject(new AppError(400, ErrorCode.VALIDATION_ERROR, 'Expected a multipart upload'));
      return;
    }

    const fields: Record<string, string> = {};
    let file: UploadedFile | undefined;
    let tooLarge = false;
    let settled = false;

    const fail = (error: AppError): void => {
      if (settled) return;
      settled = true;
      req.unpipe(parser);
      reject(error);
    };

    parser.on('field', (name, value) => {
      fields[name] = value;
    });

    parser.on('file', (_name, stream, info) => {
      const chunks: Buffer[] = [];
      let size = 0;

      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        chunks.push(chunk);
      });

      // busboy raises this the moment the cap is passed, so the process never holds more
      // than 10MB plus one chunk — the point of checking while reading rather than after.
      stream.on('limit', () => {
        tooLarge = true;
        chunks.length = 0;
      });

      stream.on('end', () => {
        if (tooLarge) return;
        file = { body: Buffer.concat(chunks), reportedName: info.filename ?? '', size };
      });
    });

    parser.on('error', () => {
      fail(new AppError(400, ErrorCode.VALIDATION_ERROR, 'That upload could not be read'));
    });

    parser.on('close', () => {
      if (settled) return;
      settled = true;
      if (tooLarge) {
        reject(
          new AppError(413, ErrorCode.FILE_TOO_LARGE, 'That file is larger than 10MB', {
            maxBytes: MAX_UPLOAD_BYTES,
          }),
        );
        return;
      }
      resolve({ file, fields });
    });

    req.pipe(parser);
  });
}

/**
 * A file that is present, within the cap, and genuinely an image.
 *
 * Refuses with `UNSUPPORTED_MEDIA_TYPE` for anything whose BYTES are not a format the
 * system handles — whatever the filename or the declared type claimed.
 */
export function requireImage(upload: ParsedUpload): { body: Buffer; type: SniffedType } {
  if (!upload.file || upload.file.size === 0) {
    throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'No file was uploaded');
  }

  const type = sniffImage(upload.file.body);
  if (!type) {
    throw new AppError(
      415,
      ErrorCode.UNSUPPORTED_MEDIA_TYPE,
      'That file is not a JPEG, PNG, WebP or HEIC image',
    );
  }

  return { body: upload.file.body, type };
}
