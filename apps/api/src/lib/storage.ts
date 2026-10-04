import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { env } from '../config/env';

/** Private file storage. Keys are opaque paths; files are only served through access-checked routes. */
export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

class LocalDiskStorage implements FileStorage {
  constructor(private readonly root: string) {}

  private path(key: string): string {
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.path(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
}

export const storage: FileStorage = new LocalDiskStorage(resolve(env.STORAGE_DIR));
