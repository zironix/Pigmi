import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertAuthorizedFile,
  assertAuthorizedProjectPath,
  authorizeDirectory,
  authorizeFile,
  resetPathPermissions,
} from '../src/main/security/pathPermissions';

const temporaryDirectories = [];

afterEach(async () => {
  resetPathPermissions();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { force: true, recursive: true })),
  );
});

async function createTemporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pigmi-permissions-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('path permissions', () => {
  it('allows project files only under the selected directory', async () => {
    const projectDirectory = await createTemporaryDirectory();
    const otherDirectory = await createTemporaryDirectory();
    const canonicalProjectDirectory = await authorizeDirectory(projectDirectory);

    await expect(
      assertAuthorizedProjectPath(path.join(projectDirectory, 'palette.json')),
    ).resolves.toBe(path.join(canonicalProjectDirectory, 'palette.json'));
    await expect(
      assertAuthorizedProjectPath(path.join(otherDirectory, 'private.json')),
    ).rejects.toThrow('outside the selected project folder');
  });

  it('allows only explicitly selected attachment files', async () => {
    const directory = await createTemporaryDirectory();
    const selectedFile = path.join(directory, 'selected.png');
    const otherFile = path.join(directory, 'other.png');
    await fs.writeFile(selectedFile, 'selected');
    await fs.writeFile(otherFile, 'other');
    const canonicalSelectedFile = await authorizeFile(selectedFile);

    await expect(assertAuthorizedFile(selectedFile)).resolves.toBe(canonicalSelectedFile);
    await expect(assertAuthorizedFile(otherFile)).rejects.toThrow('not selected by the user');
  });
});
