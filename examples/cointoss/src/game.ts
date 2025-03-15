import { CoinTossGame, GameStatus, StorageProvider } from "./types.js";
import { WalletService, type AgentWalletData } from "./walletService.js";
import { Coinbase } from "@coinbase/coinbase-sdk";

export class GameManager {
  private lastGameId: number = 0;
  private walletService: WalletService;

  constructor(
    private storage: StorageProvider,
    private agentAddress: string
  ) {
    this.walletService = new WalletService(agentAddress);
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
    console.log(`🎮 CREATING NEW GAME`);
    console.log(`👤 Creator: ${creator}`);
    console.log(`💰 Bet Amount: ${betAmount} USDC`);
    
    // Create a new wallet for this game
    console.log(`🔑 Creating wallet for the game...`);
    const gameId = this.getNextGameId();
    console.log(`🆔 Generated Game ID: ${gameId}`);
    
    const gameWallet = await this.walletService.createWallet(`game:${gameId}`);
    console.log(`✅ Game wallet created: ${gameWallet.agent_address}`);
    
    const game: CoinTossGame = {
      id: gameId,
      creator,
      betAmount,
      status: GameStatus.CREATED,
      participants: [],
      walletAddress: gameWallet.agent_address,
      createdAt: Date.now(),
    };

    console.log(`💾 Saving game to storage...`);
    await this.storage.saveGame(game);
    console.log(`🎮 Game created successfully!`);
    console.log(`---------------------------------------------`);
    console.log(`GAME ID: ${gameId}`);
    console.log(`GAME WALLET: ${gameWallet.agent_address}`);
    console.log(`BET AMOUNT: ${betAmount} USDC`);
    console.log(`STATUS: ${game.status}`);
    console.log(`---------------------------------------------`);
    
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

  async verifyPayment(userId: string, gameId: string): Promise<boolean> {
    const game = await this.storage.getGame(gameId);
    if (!game) {
      return false;
    }

    // Get user's wallet
    const userWallet = await this.walletService.getWallet(userId);
    if (!userWallet) {
      return false;
    }

    try {
      // Check if the user has already transferred funds
      const gameWalletBalance = await this.walletService.checkBalance(`game:${gameId}`);
      if (!gameWalletBalance.address) return false;

      // Check if the game wallet has the required funds
      return gameWalletBalance.balance >= parseFloat(game.betAmount);
    } catch (error) {
      console.error("Error verifying payment:", error);
      return false;
    }
  }

  async makePayment(userId: string, gameId: string, amount: string): Promise<boolean> {
    console.log(`💸 PROCESSING PAYMENT`);
    console.log(`👤 User: ${userId}`);
    console.log(`🎮 Game ID: ${gameId}`);
    console.log(`💰 Amount: ${amount} USDC`);
    
    try {
      // Get user's wallet
      console.log(`🔑 Getting user wallet...`);
      const userWallet = await this.walletService.getWallet(userId);
      if (!userWallet) {
        console.error(`❌ User wallet not found for ${userId}`);
        throw new Error("User wallet not found");
      }
      console.log(`✅ User wallet found: ${userWallet.agent_address}`);

      // Get game wallet
      console.log(`🔑 Getting game information...`);
      const game = await this.storage.getGame(gameId);
      if (!game) {
        console.error(`❌ Game not found: ${gameId}`);
        throw new Error("Game not found");
      }
      console.log(`✅ Game found, game wallet address: ${game.walletAddress}`);

      // Transfer funds from user to game wallet
      console.log(`💸 Transferring ${amount} USDC from ${userId} to game wallet ${game.walletAddress}...`);
      const transfer = await this.walletService.transfer(
        userId,
        game.walletAddress,
        parseFloat(amount)
      );
      
      if (transfer) {
        console.log(`✅ Payment successful!`);
        return true;
      } else {
        console.error(`❌ Payment failed.`);
        return false;
      }
    } catch (error) {
      console.error(`❌ Error making payment:`, error);
      return false;
    }
  }

  async executeCoinToss(gameId: string): Promise<CoinTossGame> {
    console.log(`🎲 EXECUTING COIN TOSS for Game: ${gameId}`);
    
    const game = await this.storage.getGame(gameId);
    if (!game) {
      console.error(`❌ Game not found: ${gameId}`);
      throw new Error("Game not found");
    }

    if (game.status !== GameStatus.READY) {
      console.error(`❌ Game is not ready for coin toss. Current status: ${game.status}`);
      throw new Error("Game is not ready for coin toss");
    }

    if (game.participants.length !== 2) {
      console.error(`❌ Game needs exactly 2 players. Current player count: ${game.participants.length}`);
      throw new Error("Game needs exactly 2 players");
    }

    console.log(`👥 Game participants: ${game.participants[0]}, ${game.participants[1]}`);
    console.log(`💰 Total pot: ${parseFloat(game.betAmount) * 2} USDC`);
    
    game.status = GameStatus.IN_PROGRESS;
    await this.storage.updateGame(game);
    console.log(`🏁 Game status updated to IN_PROGRESS`);

    // Perform the coin toss
    console.log(`🎲 Flipping the coin...`);
    const result = Math.random() < 0.5;
    const winnerIndex = result ? 0 : 1;
    const winner = game.participants[winnerIndex];
    const loser = game.participants[1 - winnerIndex];
    
    console.log(`🎯 Coin toss result: ${result ? 'HEADS' : 'TAILS'}`);
    console.log(`🏆 Winner is: ${winner}`);
    console.log(`😢 Loser is: ${loser}`);
    
    // Update game with result
    game.winner = winner;
    game.status = GameStatus.COMPLETED;
    
    // Transfer winnings from game wallet to winner
    const totalAmount = parseFloat(game.betAmount) * 2;
    console.log(`💸 Transferring winnings (${totalAmount} USDC) to winner's wallet...`);
    
    try {
      // Get game wallet then transfer to winner
      const gameWallet = await this.walletService.getWallet(`game:${gameId}`);
      if (!gameWallet) {
        console.error(`❌ Game wallet not found`);
        throw new Error("Game wallet not found");
      }
      
      const transfer = await this.walletService.transfer(
        `game:${gameId}`,
        winner,
        totalAmount
      );
      
      if (transfer) {
        console.log(`✅ Winnings transferred successfully to ${winner}!`);
      } else {
        console.error(`❌ Failed to transfer winnings`);
        // We still mark the game as completed even if transfer fails
        // The admin would need to handle this situation manually
      }
    } catch (error) {
      console.error(`❌ Error transferring winnings:`, error);
      // We still mark the game as completed
    }
    
    // Save final game state
    await this.storage.updateGame(game);
    console.log(`🏁 Game completed. Final status saved.`);
    
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

  async getUserBalance(userId: string): Promise<number> {
    try {
      const balance = await this.walletService.checkBalance(userId);
      return balance.balance;
    } catch (error) {
      console.error("Error getting user balance:", error);
      return 0;
    }
  }
} 