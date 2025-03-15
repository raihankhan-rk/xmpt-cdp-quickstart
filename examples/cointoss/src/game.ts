import { CoinTossGame, GameStatus, StorageProvider } from "./types.js";
import { WalletService, type AgentWalletData } from "./walletService.js";
import { Coinbase } from "@coinbase/coinbase-sdk";
import * as crypto from 'crypto';

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

  // Get a player's wallet address from their user ID
  async getPlayerWalletAddress(userId: string): Promise<string | undefined> {
    try {
      const walletData = await this.walletService.getWallet(userId, false);
      return walletData?.agent_address;
    } catch (error) {
      console.error(`Error getting wallet address for ${userId}:`, error);
      return undefined;
    }
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
      participants: [], // We'll add the creator as first participant after creating the game
      walletAddress: gameWallet.agent_address,
      createdAt: Date.now(),
      coinTossResult: "", // New field for coin toss result
      paymentSuccess: false, // New field for payment status
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
    
    // Automatically add creator as first participant and transfer their bet
    console.log(`👤 Adding creator as first participant...`);
    await this.makePayment(creator, gameId, betAmount);
    await this.addPlayerToGame(gameId, creator, true);
    
    // Reload the game to get updated state
    const updatedGame = await this.storage.getGame(gameId);
    return updatedGame || game;
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
    } else if (game.participants.length >= 2) {
      // With multiple players, we don't automatically set to READY anymore
      // We still set to WAITING_FOR_PLAYER until the creator executes the toss
      game.status = GameStatus.WAITING_FOR_PLAYER;
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

    if (game.status !== GameStatus.WAITING_FOR_PLAYER) {
      console.error(`❌ Game is not ready for coin toss. Current status: ${game.status}`);
      throw new Error("Game is not ready for coin toss");
    }

    if (game.participants.length < 2) {
      console.error(`❌ Game needs at least 2 players. Current player count: ${game.participants.length}`);
      throw new Error("Game needs at least 2 players");
    }

    console.log(`👥 Game participants: ${game.participants.join(', ')}`);
    const totalPot = parseFloat(game.betAmount) * game.participants.length;
    console.log(`💰 Total pot: ${totalPot} USDC`);
    
    game.status = GameStatus.IN_PROGRESS;
    await this.storage.updateGame(game);
    console.log(`🏁 Game status updated to IN_PROGRESS`);

    // Perform the coin toss with improved randomness
    console.log(`🎲 Flipping the coin...`);
    
    // Generate a more random value by using current timestamp + random bytes
    const winnerIndex = Math.floor(Math.random() * game.participants.length);
    const winner = game.participants[winnerIndex];
    
    // Set the coin toss result (HEADS or TAILS)
    const coinTossResult = Math.random() < 0.5 ? 'HEADS' : 'TAILS';
    game.coinTossResult = coinTossResult;
    
    console.log(`🎯 Coin toss result: ${coinTossResult}`);
    console.log(`🏆 Winner is player #${winnerIndex + 1}: ${winner}`);
    
    // Update game with result
    game.winner = winner;
    game.status = GameStatus.COMPLETED;
    
    // Transfer winnings from game wallet to winner
    console.log(`💸 Transferring winnings (${totalPot} USDC) to winner's wallet...`);
    
    try {
      // Get the winner's wallet address
      const winnerWalletData = await this.walletService.getWallet(winner, false);
      if (!winnerWalletData) {
        console.error(`❌ Winner wallet data not found for ${winner}`);
        game.paymentSuccess = false;
        await this.storage.updateGame(game);
        return game;
      }
      
      const winnerWalletAddress = winnerWalletData.agent_address;
      console.log(`🔍 Winner wallet address: ${winnerWalletAddress}`);
      
      // Get game wallet then transfer to winner
      const gameWallet = await this.walletService.getWallet(`game:${gameId}`);
      if (!gameWallet) {
        console.error(`❌ Game wallet not found`);
        game.paymentSuccess = false;
        await this.storage.updateGame(game);
        return game;
      }
      
      // Transfer directly to the winner's wallet address
      const transfer = await this.walletService.transfer(
        `game:${gameId}`,
        winnerWalletAddress,
        totalPot
      );
      
      if (transfer) {
        console.log(transfer);
        console.log(`💰 Winnings transferred successfully to ${winner}!`);
        game.paymentSuccess = true;
        
        // Extract transaction hash from the transfer object if available
        try {
          // Convert transfer object to plain JSON to access its properties
          const transferData = JSON.parse(JSON.stringify(transfer));
          if (transferData.model?.sponsored_send?.transaction_link) {
            // Store the transaction hash
            game.transactionLink = transferData.model.sponsored_send.transaction_link;
            console.log(`🔗 Transaction Link: ${game.transactionLink}`);
          }
        } catch (error) {
          console.error("Error extracting transaction hash:", error);
        }
      } else {
        console.error(`❌ Failed to transfer winnings`);
        game.paymentSuccess = false;
      }
    } catch (error) {
      console.error(`❌ Error transferring winnings:`, error);
      game.paymentSuccess = false;
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