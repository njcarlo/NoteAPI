import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Storage } from '@google-cloud/storage';
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

/** Google Cloud Storage. The bucket must not be public; the API streams files after access checks. */
class CloudStorage implements FileStorage {
  private readonly bucket;

  constructor(bucketName: string) {
    this.bucket = new Storage().bucket(bucketName);
  }

  async put(key: string, data: Buffer): Promise<void> {
    await this.bucket.file(key).save(data, { resumable: false });
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const [data] = await this.bucket.file(key).download();
      return data;
    } catch (error) {
      if ((error as { code?: number }).code === 404) return null;
      throw error;
    }
  }
}

export const storage: FileStorage =
  env.STORAGE_DRIVER === 'gcs'
    ? new CloudStorage(env.GCS_BUCKET as string)
    : new LocalDiskStorage(resolve(env.STORAGE_DIR));
