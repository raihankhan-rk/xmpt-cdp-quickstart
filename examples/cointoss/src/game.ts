import { CdpWalletProvider } from "@coinbase/agentkit";
import { CoinTossGame, GameStatus, StorageProvider } from "./types.js";
import { createGameWallet } from "./cdp.js";

export class GameManager {
  private lastGameId: number = 0;

  constructor(private storage: StorageProvider) {
    // Initialize lastGameId from storage
    this.initializeLastGameId();
  }

  private async initializeLastGameId() {
    const games = await this.storage.listActiveGames();
    this.lastGameId = games.reduce((maxId, game) => {
      const id = parseInt(game.id);
      return isNaN(id) ? maxId : Math.max(maxId, id);
    }, 0);
  }

  private getNextGameId(): string {
    return (++this.lastGameId).toString();
  }

  async createGame(creator: string, betAmount: string): Promise<CoinTossGame> {
    const { walletAddress, exportedWallet } = await createGameWallet(this.storage);
    
    const gameId = this.getNextGameId();
    const game: CoinTossGame = {
      id: gameId,
      creator,
      betAmount,
      status: GameStatus.CREATED,
      participants: [],
      walletAddress,
      createdAt: Date.now(),
    };

    await this.storage.saveGame(game);
    return game;
  }

  async addPlayerToGame(gameId: string, player: string, hasPaid: boolean): Promise<CoinTossGame> {
    const game = await this.storage.getGame(gameId);
    if (!game) {
      throw new Error("Game not found");
    }

    if (game.status !== GameStatus.CREATED && game.status !== GameStatus.WAITING_FOR_PLAYER) {
      throw new Error("Game is not accepting players");
    }

    if (game.participants.includes(player)) {
      throw new Error("You are already in this game");
    }

    if (!hasPaid) {
      throw new Error(`Please pay ${game.betAmount} USDC to join the game`);
    }

    game.participants.push(player);
    
    // Update game status based on number of participants
    if (game.participants.length === 1) {
      game.status = GameStatus.WAITING_FOR_PLAYER;
    } else if (game.participants.length === 2) {
      game.status = GameStatus.READY;
    }

    await this.storage.updateGame(game);
    return game;
  }

  async joinGame(gameId: string, player: string): Promise<CoinTossGame> {
    const game = await this.storage.getGame(gameId);
    if (!game) {
      throw new Error("Game not found");
    }

    if (game.status !== GameStatus.CREATED && game.status !== GameStatus.WAITING_FOR_PLAYER) {
      throw new Error("Game is not accepting players");
    }

    if (game.participants.includes(player)) {
      throw new Error("You are already in this game");
    }

    // Don't add the player yet, just return the game info
    return game;
  }

  async executeCoinToss(gameId: string): Promise<CoinTossGame> {
    const game = await this.storage.getGame(gameId);
    if (!game) {
      throw new Error("Game not found");
    }

    if (game.status !== GameStatus.READY) {
      throw new Error("Game is not ready for coin toss");
    }

    if (game.participants.length !== 2) {
      throw new Error("Game needs exactly 2 players");
    }

    game.status = GameStatus.IN_PROGRESS;
    await this.storage.updateGame(game);

    // Perform the coin toss
    const result = Math.random() < 0.5;
    const winnerIndex = result ? 0 : 1;
    game.winner = game.participants[winnerIndex];
    game.status = GameStatus.COMPLETED;

    await this.storage.updateGame(game);
    return game;
  }

  async listActiveGames(): Promise<CoinTossGame[]> {
    return this.storage.listActiveGames();
  }

  async getGame(gameId: string): Promise<CoinTossGame | null> {
    return this.storage.getGame(gameId);
  }

  async cancelGame(gameId: string): Promise<CoinTossGame> {
    const game = await this.storage.getGame(gameId);
    if (!game) {
      throw new Error("Game not found");
    }

    if (game.status === GameStatus.COMPLETED) {
      throw new Error("Cannot cancel completed game");
    }

    game.status = GameStatus.CANCELLED;
    await this.storage.updateGame(game);
    return game;
  }
} 