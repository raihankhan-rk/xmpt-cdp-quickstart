import fs from "fs/promises";
import path from "path";

export class LocalStorage {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.initDirectory();
  }

  private async initDirectory() {
    try {
      await fs.mkdir(this.baseDir, { recursive: true });
    } catch (error) {
      console.error("Error creating directory:", error);
    }
  }

  async set(key: string, value: string) {
    try {
      const filePath = path.join(this.baseDir, `${key}.json`);
      await fs.writeFile(filePath, value);
      return true;
    } catch (error) {
      console.error("Error writing to storage:", error);
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      const filePath = path.join(this.baseDir, `${key}.json`);
      const data = await fs.readFile(filePath, "utf-8");
      return data;
    } catch (error) {
      return null;
    }
  }

  async del(key: string): Promise<boolean> {
    try {
      const filePath = path.join(this.baseDir, `${key}.json`);
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      console.error("Error deleting from storage:", error);
      return false;
    }
  }

  async getWalletCount(): Promise<number> {
    try {
      const files = await fs.readdir(this.baseDir);
      const walletFiles = files.filter(file => file.startsWith("wallet:") && file.endsWith(".json"));
      return walletFiles.length;
    } catch (error) {
      console.error("Error getting wallet count:", error);
      return 0;
    }
  }
} 