import { createClient } from "redis";
import fs from "fs/promises";
import path from "path";
import { CoinTossGame, StorageProvider, UserWallet } from "./types.js";

export class LocalStorageProvider implements StorageProvider {
  private gamesDir: string;
  private walletsDir: string;

  constructor() {
    this.gamesDir = path.join(process.cwd(), "data", "games");
    this.walletsDir = path.join(process.cwd(), "wallet_data");
    this.initDirectories();
  }

  private async initDirectories() {
    await fs.mkdir(this.gamesDir, { recursive: true });
    await fs.mkdir(this.walletsDir, { recursive: true });
  }

  async saveGame(game: CoinTossGame): Promise<void> {
    const filePath = path.join(this.gamesDir, `${game.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(game, null, 2));
  }

  async getGame(gameId: string): Promise<CoinTossGame | null> {
    try {
      const filePath = path.join(this.gamesDir, `${gameId}.json`);
      const data = await fs.readFile(filePath, "utf-8");
      return JSON.parse(data);
    } catch (error) {
      return null;
    }
  }

  async listActiveGames(): Promise<CoinTossGame[]> {
    const files = await fs.readdir(this.gamesDir);
    const games: CoinTossGame[] = [];

    for (const file of files) {
      if (file.endsWith(".json")) {
        const game = await this.getGame(file.replace(".json", ""));
        if (game && game.status !== "COMPLETED" && game.status !== "CANCELLED") {
          games.push(game);
        }
      }
    }

    return games;
  }

  async updateGame(game: CoinTossGame): Promise<void> {
    await this.saveGame(game);
  }

  async saveUserWallet(wallet: UserWallet): Promise<void> {
    const filePath = path.join(this.walletsDir, `${wallet.userId}.json`);
    await fs.writeFile(filePath, JSON.stringify(wallet, null, 2));
  }

  async getUserWallet(userId: string): Promise<string | null> {
    try {
      const filePath = path.join(this.walletsDir, `${userId}.json`);
      const data = await fs.readFile(filePath, "utf-8");
      const wallet = JSON.parse(data) as UserWallet;
      return wallet.walletData;
    } catch (error) {
      return null;
    }
  }
}

export class RedisStorageProvider implements StorageProvider {
  private client: ReturnType<typeof createClient>;
  private readonly gamePrefix = "game:";
  private readonly walletPrefix = "wallet:";

  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL
    });
    this.client.connect();
  }

  async saveGame(game: CoinTossGame): Promise<void> {
    await this.client.set(
      this.gamePrefix + game.id,
      JSON.stringify(game)
    );
  }

  async getGame(gameId: string): Promise<CoinTossGame | null> {
    const data = await this.client.get(this.gamePrefix + gameId);
    return data ? JSON.parse(data) : null;
  }

  async listActiveGames(): Promise<CoinTossGame[]> {
    const keys = await this.client.keys(this.gamePrefix + "*");
    const games: CoinTossGame[] = [];

    for (const key of keys) {
      const game = await this.getGame(key.replace(this.gamePrefix, ""));
      if (game && game.status !== "COMPLETED" && game.status !== "CANCELLED") {
        games.push(game);
      }
    }

    return games;
  }

  async updateGame(game: CoinTossGame): Promise<void> {
    await this.saveGame(game);
  }

  async saveUserWallet(wallet: UserWallet): Promise<void> {
    await this.client.set(
      this.walletPrefix + wallet.userId,
      wallet.walletData
    );
  }

  async getUserWallet(userId: string): Promise<string | null> {
    return this.client.get(this.walletPrefix + userId);
  }
} 