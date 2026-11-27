import { createGcpAuth } from './_lib/gcp-auth.js';
import { createFirestore } from './_lib/firestore.js';

const auth = createGcpAuth();
const db = createFirestore({ projectId: auth.projectId, getAccessToken: auth.getAccessToken });

export function decodeImage(data) {
  if (typeof data !== 'string' || data.length > 480000 || data.length % 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return null;
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length < 20) return null;
  const webp = bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.readUInt32LE(4) === bytes.length - 8 && bytes.toString('ascii', 8, 12) === 'WEBP' &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
    bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  if (!webp && !jpeg) return null;
  return { bytes, mime: webp ? 'image/webp' : 'image/jpeg' };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }
  const id = req.query.id;
  if (typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)) return res.status(404).end();
  try {
    const record = await db.get('content_images/' + id);
    const image = decodeImage(record?.data?.data);
    if (!image) return res.status(404).end();
    res.setHeader('Content-Type', image.mime);
    res.setHeader('Content-Length', image.bytes.length);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).end(req.method === 'HEAD' ? undefined : image.bytes);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).end();
  }
}
