const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dialog, nativeImage, BrowserWindow } = require('electron');

// Files the composer has attached, by id. The window only ever sees
// { id, name, size, type, thumb }: picked files are read here, from the path the
// open-file dialog returned, so the window can't ask for any other file.
const MAX_FILE = 25 * 1024 * 1024; // Gmail's limit for a whole message
const files = new Map();

const IMAGE_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp'
};

function thumbnail(image) {
  if (!image || image.isEmpty()) return null;
  const { width, height } = image.getSize();
  const scale = Math.min(1, 240 / Math.max(width, height));
  return image.resize({ width: Math.round(width * scale), height: Math.round(height * scale) }).toDataURL();
}

function register(entry, image) {
  const id = crypto.randomUUID();
  files.set(id, entry);
  return { id, name: entry.name, size: entry.size, type: entry.type, thumb: entry.type.startsWith('image/') ? thumbnail(image) : null };
}

const tooBig = (name) => ({ ok: false, error: `${name} is larger than 25 MB, which most mail servers refuse.` });

// The "+" button: the system's open-file dialog.
async function pick() {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title: 'Attach files',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All files', extensions: ['*'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic'] },
      { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'odt', 'rtf', 'zip'] }
    ]
  });
  if (result.canceled) return { ok: true, files: [] };

  const added = [];
  for (const filePath of result.filePaths) {
    const name = path.basename(filePath);
    let size;
    try {
      size = fs.statSync(filePath).size;
    } catch {
      return { ok: false, error: `Could not read ${name}.`, files: added };
    }
    if (size > MAX_FILE) return { ...tooBig(name), files: added };
    const type = IMAGE_TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream';
    const image = type.startsWith('image/') ? nativeImage.createFromPath(filePath) : null;
    added.push(register({ name, size, type, path: filePath }, image));
  }
  return { ok: true, files: added };
}

// Files dropped on the window or pasted from the clipboard arrive as bytes.
function addData(name, type, bytes) {
  const safeName = path.basename(String(name || 'attachment')).slice(0, 200) || 'attachment';
  if (!(bytes instanceof Uint8Array)) return { ok: false, error: 'That file could not be read.' };
  if (bytes.length > MAX_FILE) return tooBig(safeName);
  const mime = /^[\w.+-]+\/[\w.+-]+$/.test(String(type)) ? String(type) : 'application/octet-stream';
  const content = Buffer.from(bytes);
  const image = mime.startsWith('image/') ? nativeImage.createFromBuffer(content) : null;
  return { ok: true, file: register({ name: safeName, size: content.length, type: mime, content }, image) };
}

function discard(ids) {
  for (const id of [].concat(ids || [])) files.delete(id);
}

// nodemailer attachments for these ids (unknown ids are an error, not skipped).
function attachmentsFor(ids) {
  return ids.map((id) => {
    const entry = files.get(id);
    if (!entry) throw Object.assign(new Error('An attachment is no longer available. Remove it and add it again.'), { userFacing: true });
    return entry.path
      ? { filename: entry.name, path: entry.path, contentType: entry.type }
      : { filename: entry.name, content: entry.content, contentType: entry.type };
  });
}

const sizeOf = (ids) => ids.reduce((sum, id) => sum + ((files.get(id) || {}).size || 0), 0);

module.exports = { pick, addData, discard, attachmentsFor, sizeOf, MAX_FILE };
