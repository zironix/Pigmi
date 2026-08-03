import { promises as fs } from 'node:fs';
import path from 'node:path';

let authorizedDirectory = null;
const authorizedFiles = new Set();

function isInsideDirectory(directoryPath, candidatePath) {
  const relativePath = path.relative(directoryPath, candidatePath);
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== '..' &&
      !path.isAbsolute(relativePath))
  );
}

async function canonicalizePotentialPath(filePath) {
  const absolutePath = path.resolve(filePath);
  try {
    return await fs.realpath(absolutePath);
  } catch {
    const parentPath = await fs.realpath(path.dirname(absolutePath));
    return path.join(parentPath, path.basename(absolutePath));
  }
}

export async function authorizeDirectory(directoryPath) {
  authorizedDirectory = await fs.realpath(path.resolve(directoryPath));
  return authorizedDirectory;
}

export async function authorizeFile(filePath) {
  const canonicalPath = await fs.realpath(path.resolve(filePath));
  authorizedFiles.add(canonicalPath);
  return canonicalPath;
}

export async function assertAuthorizedProjectPath(filePath) {
  if (!authorizedDirectory) {
    throw new Error('Select a project folder before accessing files');
  }

  const canonicalPath = await canonicalizePotentialPath(filePath);
  if (!isInsideDirectory(authorizedDirectory, canonicalPath)) {
    throw new Error('File access is outside the selected project folder');
  }
  return canonicalPath;
}

export async function assertAuthorizedFile(filePath) {
  const canonicalPath = await fs.realpath(path.resolve(filePath));
  if (!authorizedFiles.has(canonicalPath)) {
    throw new Error('File was not selected by the user');
  }
  return canonicalPath;
}

export function resetPathPermissions() {
  authorizedDirectory = null;
  authorizedFiles.clear();
}
