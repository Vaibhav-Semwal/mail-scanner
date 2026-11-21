const { BrowserWindow, nativeImage } = require('electron');
const crypto = require('crypto');
const log = require('../logger');

// Round sender pictures for notifications.
//   1. The sender's Gravatar photo, if they have one (Gmail's own profile photos
//      are not available to IMAP apps).
//   2. Otherwise the same coloured initial the app shows in the list.
// Drawing happens on a canvas in a small hidden window; the main process has no
// way to draw text into an image itself.

const SIZE = 256;
const PHOTO_TIMEOUT_MS = 2500;
const CACHE_LIMIT = 200;
const AVATAR_HUES = [174, 205, 260, 330, 18, 42, 140, 290]; // same as renderer/js/dom.js

const cache = new Map(); // "address|name" -> NativeImage
const photos = new Map(); // address -> Buffer data URL, or null when there is none
let painter = null;

const initialOf = (name) => (String(name || '?').trim().replace(/^["'<]+/, '').charAt(0) || '?').toUpperCase();
function hueOf(name) {
  let hash = 0;
  for (const ch of String(name || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_HUES[hash % AVATAR_HUES.length];
}

// Gravatar answers 404 (d=404) when the address has no photo.
async function photoFor(address) {
  if (!address || !address.includes('@')) return null;
  if (photos.has(address)) return photos.get(address);
  let result = null;
  try {
    const hash = crypto.createHash('md5').update(address.trim().toLowerCase()).digest('hex');
    const res = await fetch(`https://www.gravatar.com/avatar/${hash}?s=${SIZE}&d=404`, {
      signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS)
    });
    const type = res.headers.get('content-type') || '';
    if (res.ok && /^image\/(png|jpeg|gif|webp)/.test(type)) {
      result = `data:${type.split(';')[0]};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
    }
    photos.set(address, result); // remember "no photo" too, for this session
  } catch {
    // Offline or slow: use the initial this time, try again next time.
  }
  return result;
}

async function getPainter() {
  if (painter && !painter.isDestroyed()) return painter;
  painter = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    width: SIZE,
    height: SIZE,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  painter.webContents.on('render-process-gone', () => painter && !painter.isDestroyed() && painter.destroy());
  await painter.loadURL('about:blank');
  return painter;
}

// Runs inside the hidden page. Values arrive JSON-encoded, never as code.
const DRAW = `(async ({ size, photo, initial, hue }) => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  g.closePath();
  g.clip();
  if (photo) {
    const img = new Image();
    img.src = photo;
    await img.decode();
    g.drawImage(img, 0, 0, size, size);
  } else {
    g.fillStyle = 'hsl(' + hue + ' 55% 40%)';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#ffffff';
    g.font = '600 ' + Math.round(size * 0.46) + 'px "Segoe UI", system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(initial, size / 2, size / 2 + size * 0.02);
  }
  return canvas.toDataURL('image/png');
})`;

// NativeImage for the sender of an email, or null if it could not be made.
async function avatarFor(item) {
  if (!item) return null;
  const address = item.fromAddress || '';
  const key = `${address}|${item.from}`;
  if (cache.has(key)) return cache.get(key);
  try {
    const photo = await photoFor(address);
    const args = { size: SIZE, photo, initial: initialOf(item.from), hue: hueOf(item.from) };
    const win = await getPainter();
    const dataUrl = await win.webContents.executeJavaScript(`${DRAW}(${JSON.stringify(args)})`);
    const image = nativeImage.createFromDataURL(dataUrl);
    if (image.isEmpty()) return null;
    // Only cache photos we found, or initials for addresses known to have none.
    if (photo || photos.has(address) || !address) {
      cache.set(key, image);
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    }
    return image;
  } catch (err) {
    log.warn('Could not make a sender picture', err);
    return null;
  }
}

function disposeAvatars() {
  if (painter && !painter.isDestroyed()) painter.destroy();
  painter = null;
}

module.exports = { avatarFor, disposeAvatars };
