export const fail = (status, message) => Object.assign(new Error(message), {status});

// Read JPEG dimensions before any paid request; reject non-JPEG and oversized images.
export function jpegDimensions(bytes) {
  if (bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) return null;
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset++] !== 255) return null;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 218 || marker === 217) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if ([192, 193, 194].includes(marker) && length >= 8) return {height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5)};
    offset += length;
  }
  return null;
}

export async function readJson(req, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw fail(413, '画面数据过大，请重试。');
    chunks.push(chunk);
  }
  try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch {throw fail(400, '请求格式不正确。');}
}

