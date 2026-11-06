import { tipoPelaAssinatura } from "./tipo-de-arquivo";

export const virtualMediaLimit = (kind: "AUDIO" | "IMAGE") =>
  (kind === "AUDIO" ? 16 : 5) * 1024 * 1024;

export class ChannelMediaError extends Error {
  constructor(public code: "MEDIA_UNAVAILABLE" | "MEDIA_LIMIT" | "MEDIA_TYPE") {
    super(code);
  }
}

function audioMp4(bytes: Buffer) {
  if (bytes.length < 24 || bytes.toString("ascii", 4, 8) !== "ftyp")
    return false;
  const handlers: string[] = [];
  const boxes = (start: number, end: number, depth: number): boolean => {
    if (depth > 5) return false;
    for (let at = start; at < end;) {
      if (at + 8 > end) return false;
      const size = bytes.readUInt32BE(at),
        type = bytes.toString("ascii", at + 4, at + 8);
      // Large/zero-sized boxes are deliberately unsupported in bounded clips.
      if (size < 8 || at + size > end) return false;
      if (["moov", "trak", "mdia"].includes(type)) {
        if (!boxes(at + 8, at + size, depth + 1)) return false;
      } else if (type === "hdlr") {
        if (size < 20) return false;
        handlers.push(bytes.toString("ascii", at + 16, at + 20));
      }
      at += size;
    }
    return true;
  };
  return (
    boxes(0, bytes.length, 0) &&
    handlers.includes("soun") &&
    !handlers.includes("vide")
  );
}

function audioType(bytes: Buffer): string | null {
  if (
    bytes.length >= 36 &&
    bytes.toString("ascii", 0, 4) === "OggS" &&
    bytes.subarray(0, 512).includes(Buffer.from("OpusHead"))
  )
    return "audio/ogg";
  if (
    bytes.length >= 44 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WAVE" &&
    bytes.toString("ascii", 12, 16) === "fmt "
  )
    return "audio/wav";
  if (audioMp4(bytes)) return "audio/mp4";
  let at = 0;
  if (bytes.length >= 10 && bytes.toString("ascii", 0, 3) === "ID3") {
    if ([...bytes.subarray(6, 10)].some((value) => value > 127)) return null;
    at = 10 + bytes.subarray(6, 10).reduce((n, value) => n * 128 + value, 0);
  }
  if (
    at + 4 < bytes.length &&
    bytes[at] === 255 &&
    (bytes[at + 1] & 0xe0) === 0xe0 &&
    (bytes[at + 1] & 0x18) !== 0x08 &&
    (bytes[at + 1] & 0x06) !== 0 &&
    (bytes[at + 2] & 0xf0) !== 0xf0 &&
    (bytes[at + 2] & 0xf0) !== 0 &&
    (bytes[at + 2] & 0x0c) !== 0x0c
  )
    return "audio/mpeg";
  return null;
}

const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
};

/** The declared MIME never overrides the bytes or the requested message kind. */
export function validateVirtualMedia(
  bytes: Uint8Array,
  kind: "AUDIO" | "IMAGE",
  declaredType: unknown,
) {
  if (bytes.length > virtualMediaLimit(kind))
    throw new ChannelMediaError("MEDIA_LIMIT");
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
    contentType =
      kind === "IMAGE" ? tipoPelaAssinatura(buffer) : audioType(buffer);
  const declared =
    typeof declaredType === "string"
      ? declaredType.split(";")[0].trim().toLowerCase()
      : "";
  const aliases: Record<string, string> = {
    "audio/mp3": "audio/mpeg",
    "audio/x-wav": "audio/wav",
  };
  const canonicalDeclared = aliases[declared] ?? declared;
  if (!contentType || canonicalDeclared !== contentType)
    throw new ChannelMediaError("MEDIA_TYPE");
  return { bytes, contentType, extension: extensions[contentType] };
}
