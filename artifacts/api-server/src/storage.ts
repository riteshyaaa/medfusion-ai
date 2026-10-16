import path from "node:path";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";

export interface PrivateStorage {
  put(key: string, bytes: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export class LocalPrivateStorage implements PrivateStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolveKey(key: string): string {
    if (!/^[0-9a-f-]{36}\.(?:jpg|pdf)$/.test(key)) {
      throw new Error("Invalid storage key");
    }
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(`${this.root}${path.sep}`)) {
      throw new Error("Invalid storage key");
    }
    return resolved;
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await writeFile(this.resolveKey(key), bytes, { flag: "wx", mode: 0o600 });
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolveKey(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
