import { promises as fs } from 'node:fs';
import path from 'node:path';
import { dialog, nativeImage, shell } from 'electron';

import { IPC_CHANNELS } from '../../shared/ipcChannels';
import {
  assertAuthorizedProjectPath,
  authorizeDirectory,
  authorizeFile,
} from '../security/pathPermissions';

const IMAGE_MIME_TYPES = Object.freeze({
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
});
const IMAGE_PREVIEW_MAX_SIDE = 512;

function createImagePreview(contents, mime) {
  const image = nativeImage.createFromBuffer(contents);
  if (image.isEmpty()) {
    return `data:${mime};base64,${contents.toString('base64')}`;
  }

  const { height, width } = image.getSize();
  const largestSide = Math.max(height, width);
  if (largestSide <= IMAGE_PREVIEW_MAX_SIDE) {
    return image.toDataURL();
  }

  const scale = IMAGE_PREVIEW_MAX_SIDE / largestSide;
  return image
    .resize({
      height: Math.max(1, Math.round(height * scale)),
      quality: 'good',
      width: Math.max(1, Math.round(width * scale)),
    })
    .toDataURL();
}

function assertPath(value, argumentName = 'path') {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${argumentName} must be a non-empty string`);
  }
  return value;
}

async function ensureParentDirectory(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export function registerFileHandlers(ipcMain) {
  ipcMain.handle(IPC_CHANNELS.selectFolder, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : authorizeDirectory(result.filePaths[0]);
  });

  ipcMain.handle(IPC_CHANNELS.selectImageFile, async () => {
    const result = await dialog.showOpenDialog({
      filters: [
        {
          extensions: Object.keys(IMAGE_MIME_TYPES).map((extension) => extension.slice(1)),
          name: 'Images',
        },
      ],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = await authorizeFile(result.filePaths[0]);
    const extension = path.extname(filePath).toLowerCase();
    const mime = IMAGE_MIME_TYPES[extension] ?? 'application/octet-stream';
    const contents = await fs.readFile(filePath);

    return {
      dataUrl: createImagePreview(contents, mime),
      mime,
      name: path.basename(filePath),
      path: filePath,
    };
  });

  ipcMain.handle(IPC_CHANNELS.readDirectory, async (_event, directoryPath) => {
    const targetPath = await assertAuthorizedProjectPath(
      assertPath(directoryPath, 'directoryPath'),
    );
    const entries = await fs.readdir(targetPath, {
      withFileTypes: true,
    });
    return entries.map((entry) => ({
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      name: entry.name,
    }));
  });

  ipcMain.handle(IPC_CHANNELS.fileExists, async (_event, filePath) => {
    try {
      const targetPath = await assertAuthorizedProjectPath(assertPath(filePath, 'filePath'));
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle(IPC_CHANNELS.readTextFile, async (_event, filePath) => {
    const targetPath = await assertAuthorizedProjectPath(assertPath(filePath, 'filePath'));
    return fs.readFile(targetPath, 'utf8');
  });

  ipcMain.handle(IPC_CHANNELS.writeTextFile, async (_event, filePath, contents) => {
    const targetPath = await assertAuthorizedProjectPath(assertPath(filePath, 'filePath'));
    await ensureParentDirectory(targetPath);
    await fs.writeFile(targetPath, String(contents), 'utf8');
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.writeBinaryFile, async (_event, filePath, contents) => {
    const targetPath = await assertAuthorizedProjectPath(assertPath(filePath, 'filePath'));
    await ensureParentDirectory(targetPath);
    await fs.writeFile(targetPath, Buffer.from(contents));
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.openFolder, async (_event, folderPath) => {
    const targetPath = await assertAuthorizedProjectPath(assertPath(folderPath, 'folderPath'));
    const errorMessage = await shell.openPath(targetPath);
    return errorMessage ? { error: errorMessage, ok: false } : { ok: true };
  });
}
