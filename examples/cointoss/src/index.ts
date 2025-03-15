import * as dotenv from "dotenv";
import * as path from "path";
import { LocalStorageProvider, RedisStorageProvider } from "./storage.js";
import { GameManager } from "./game.js";
import { initializeXmtpClient, startMessageListener, createSigner } from "./xmtp.js";

// Initialize environment variables - make sure this is at the top of the file before any other code
const envPath = path.resolve(process.cwd(), '.env');
console.log("Loading .env file from:", envPath);
const result = dotenv.config({ path: envPath });
if (result.error) {
  console.error("Error loading .env file:", result.error);
} else {
  console.log("Environment variables loaded from .env file successfully");
}

/**
 * Validates that required environment variables are set
 */
function validateEnvironment(): void {
  // Load .env from parent directory
  dotenv.config({ path: '../.env' });
  const missingVars: string[] = [];

  // Check required variables
  const requiredVars = [
    "WALLET_KEY",
    "ENCRYPTION_KEY",
    "OPENAI_API_KEY",
  ];
  
  // Check Coinbase SDK variables - we need either the COINBASE_ or CDP_ prefixed versions
  const coinbaseApiKeyName = process.env.COINBASE_API_KEY_NAME || process.env.CDP_API_KEY_NAME;
  const coinbaseApiKeyPrivateKey = process.env.COINBASE_API_KEY_PRIVATE_KEY || process.env.CDP_API_KEY_PRIVATE_KEY;
  
  if (!coinbaseApiKeyName) {
    missingVars.push("COINBASE_API_KEY_NAME or CDP_API_KEY_NAME");
  }
  
  if (!coinbaseApiKeyPrivateKey) {
    missingVars.push("COINBASE_API_KEY_PRIVATE_KEY or CDP_API_KEY_PRIVATE_KEY");
  }
  
  // Check other required variables
  requiredVars.forEach((varName) => {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  });

  // Exit if any required variables are missing
  if (missingVars.length > 0) {
    console.error("Error: Required environment variables are not set");
    missingVars.forEach((varName) => {
      console.error(`${varName}=your_${varName.toLowerCase()}_here`);
    });
    process.exit(1);
  }
  
  // Log warning about KEY variable
  if (!process.env.KEY) {
    console.warn("Warning: KEY is not set, using ENCRYPTION_KEY for wallet encryption");
  }
  
  return; // Explicit return to satisfy the linter
}

/**
 * Handle incoming messages
 */
async function handleMessage(message: any, conversation: any, userId: string, content: string) {
  try {
    // Initialize storage provider (Redis if REDIS_URL is set, otherwise local)
    const storage = process.env.REDIS_URL
      ? new RedisStorageProvider()
      : new LocalStorageProvider();

    // Get agent address from XMTP client
    const client = conversation.client;
    const signer = await createSigner(process.env.WALLET_KEY!);
    const address = (await signer.getIdentifier()).identifier;

    const gameManager = new GameManager(storage, address);

    // Process the message content
    const response = await handleCommand(
      content,
      userId,
      gameManager
    );

    // Send the response back
    await conversation.send(response);
  } catch (error) {
    console.error("Error processing message:", error);
    await conversation.send(
      error instanceof Error ? error.message : "Sorry, I encountered an error. Please try again later."
    );
  }
}

async function handleCommand(
  content: string,
  userId: string,
  gameManager: GameManager
): Promise<string> {
  const [command, ...args] = content.split(" ");

  switch (command.toLowerCase()) {
    case "create": {
      const amount = args[0];
      if (!amount) {
        return "Please specify a bet amount: create <amount>";
      }

      // Check if user has sufficient balance
      const balance = await gameManager.getUserBalance(userId);
      if (balance < parseFloat(amount)) {
        return `Insufficient USDC balance. You need at least ${amount} USDC to create a game. Your balance: ${balance} USDC`;
      }

      // Create the game (creator payment will be handled automatically)
      const game = await gameManager.createGame(userId, amount);
      return `Game created!\nGame ID: ${game.id}\nBet Amount: ${game.betAmount} USDC\nYour Player ID: P1 (Creator)\n\nOther players can join with: join ${game.id}\nWhen you're ready to run the coin toss, send: execute ${game.id}`;
    }

    case "join": {
      const gameId = args[0];
      if (!gameId) {
        return "Please specify a game ID: join <gameId>";
      }

      // First check if the game exists and is joinable
      const game = await gameManager.joinGame(gameId, userId);
      
      // Check user's balance
      const balance = await gameManager.getUserBalance(userId);
      if (balance < parseFloat(game.betAmount)) {
        return `Insufficient USDC balance. You need ${game.betAmount} USDC to join this game. Your balance: ${balance} USDC`;
      }

      // Make the payment
      const paymentSuccess = await gameManager.makePayment(
        userId,
        gameId,
        game.betAmount
      );

      if (!paymentSuccess) {
        return `Payment failed. Please ensure you have enough USDC and try again.`;
      }
      
      // Add player to game after payment
      const updatedGame = await gameManager.addPlayerToGame(gameId, userId, true);
      
      // Generate player ID (P2, P3, etc. based on position)
      const playerPosition = updatedGame.participants.findIndex(p => p === userId) + 1;
      const playerId = `P${playerPosition}`;
      
      return `Successfully joined game ${gameId}! Payment of ${game.betAmount} USDC sent.\nYour Player ID: ${playerId}\nTotal players: ${updatedGame.participants.length}\nWaiting for the game creator to execute the coin toss.`;
    }

    case "execute": {
      const gameId = args[0];
      if (!gameId) {
        return "Please specify a game ID: execute <gameId>";
      }
      
      // Check if the user is the creator
      const game = await gameManager.getGame(gameId);
      if (!game) {
        return `Game ${gameId} not found.`;
      }
      
      if (game.creator !== userId) {
        return "Only the game creator can execute the coin toss.";
      }
      
      if (game.participants.length < 2) {
        return "At least 2 players are needed to execute the coin toss.";
      }
      
      const result = await gameManager.executeCoinToss(gameId);
      
      // Generate player IDs for result message
      const playerMap = await Promise.all(result.participants.map(async (player, index) => {
        const walletAddress = await gameManager.getPlayerWalletAddress(player) || player;
        return { 
          id: `P${index + 1}${player === result.creator ? " (Creator)" : ""}`, 
          address: player,
          walletAddress: walletAddress
        };
      }));
      
      // Find winning player's ID
      const winnerInfo = playerMap.find(p => p.address === result.winner);
      const winnerId = winnerInfo ? winnerInfo.id : "Unknown";
      
      // Create detailed result message
      let resultMessage = `🎲 COIN TOSS RESULTS FOR GAME #${gameId} 🎲\n\n`;
      resultMessage += `Players (${result.participants.length}):\n`;
      
      playerMap.forEach(p => {
        const displayAddress = p.walletAddress.substring(0, 10) + "..." + p.walletAddress.substring(p.walletAddress.length - 6);
        resultMessage += `${p.id}: ${displayAddress}\n`;
      });
      
      resultMessage += `\n💰 Total Pot: ${parseFloat(result.betAmount) * result.participants.length} USDC\n`;
      resultMessage += `🎯 Coin Toss Result: ${result.coinTossResult || "Unknown"}\n\n`;
      resultMessage += `🏆 WINNER: ${winnerId}\n`;
      
      // Get winner's wallet address
      const winnerWallet = winnerInfo?.walletAddress || (result.winner ? await gameManager.getPlayerWalletAddress(result.winner) : undefined);
      if (winnerWallet) {
        resultMessage += `🏆 Winner Wallet: ${winnerWallet}\n\n`;
      }
      
      if (result.paymentSuccess) {
        resultMessage += `✅ Winnings have been transferred to the winner's wallet.`;
        
        // Add transaction hash link if available
        if (result.transactionLink) {
          resultMessage += `\n🔗 Transaction: ${result.transactionLink}`;
        }
      } else {
        resultMessage += `⚠️ Automatic transfer of winnings failed. Please contact support.`;
      }
      
      return resultMessage;
    }

    case "status": {
      const gameId = args[0];
      if (!gameId) {
        return "Please specify a game ID: status <gameId>";
      }
      
      const game = await gameManager.getGame(gameId);
      if (!game) {
        return `Game ${gameId} not found.`;
      }
      
      // Generate player IDs for status message with wallet addresses
      const playerMap = await Promise.all(game.participants.map(async (player, index) => {
        const walletAddress = await gameManager.getPlayerWalletAddress(player) || player;
        return { 
          id: `P${index + 1}${player === game.creator ? " (Creator)" : ""}`, 
          address: player,
          walletAddress: walletAddress
        };
      }));
      
      let statusMessage = `🎮 GAME #${gameId} STATUS 🎮\n\n`;
      statusMessage += `Status: ${game.status}\n`;
      statusMessage += `Bet Amount: ${game.betAmount} USDC\n`;
      statusMessage += `Prize Pool: ${parseFloat(game.betAmount) * game.participants.length} USDC\n`;
      
      // Show creator's wallet address
      const creatorWallet = await gameManager.getPlayerWalletAddress(game.creator) || game.creator;
      const shortCreatorWallet = creatorWallet.substring(0, 10) + "..." + creatorWallet.substring(creatorWallet.length - 6);
      statusMessage += `Creator: ${shortCreatorWallet}\n`;
      
      statusMessage += `Game Wallet: ${game.walletAddress}\n`;
      statusMessage += `Created: ${new Date(game.createdAt).toLocaleString()}\n\n`;
      
      statusMessage += `Players (${game.participants.length}):\n`;
      
      if (game.participants.length === 0) {
        statusMessage += "No players have joined yet.\n";
      } else {
        playerMap.forEach(p => {
          const displayAddress = p.walletAddress.substring(0, 10) + "..." + p.walletAddress.substring(p.walletAddress.length - 6);
          statusMessage += `${p.id}: ${displayAddress}\n`;
        });
      }
      
      if (game.winner) {
        const winnerInfo = playerMap.find(p => p.address === game.winner);
        const winnerId = winnerInfo ? winnerInfo.id : "Unknown";
        const winnerWallet = winnerInfo?.walletAddress || await gameManager.getPlayerWalletAddress(game.winner) || game.winner;
        statusMessage += `\nWinner: ${winnerId} (${winnerWallet.substring(0, 10)}...${winnerWallet.substring(winnerWallet.length - 6)})\n`;
      }
      
      return statusMessage;
    }

    case "list": {
      const games = await gameManager.listActiveGames();
      if (games.length === 0) {
        return "No active games found.";
      }

      // Updated game descriptions with wallet addresses
      const gameDescriptions = await Promise.all(games.map(async (game) => {
        const creatorWallet = await gameManager.getPlayerWalletAddress(game.creator) || game.creator;
        const shortCreatorWallet = creatorWallet.substring(0, 10) + "..." + creatorWallet.substring(creatorWallet.length - 6);
        
        return `Game ID: ${game.id}\nBet Amount: ${game.betAmount} USDC\nStatus: ${game.status}\nPlayers: ${game.participants.length}\nCreator: ${shortCreatorWallet}\nGame Wallet: ${game.walletAddress}`;
      }));
      
      return gameDescriptions.join("\n\n");
    }

    case "balance": {
      const balance = await gameManager.getUserBalance(userId);
      const walletAddress = await gameManager.getPlayerWalletAddress(userId);
      return `Your USDC balance: ${balance}\nYour wallet address: ${walletAddress}`;
    }

    case "help":
      return `Available commands:
create <amount> - Create a new coin toss game with specified USDC bet amount
join <gameId> - Join an existing game with the specified ID
execute <gameId> - Execute the coin toss (only for game creator)
status <gameId> - Check the status of a specific game
list - List all active games
balance - Check your wallet balance and address
help - Show this help message`;

    default:
      return "Unknown command. Type help to see available commands.";
  }
}

async function main(): Promise<void> {
  console.log("Starting CoinToss Agent...");

  // Validate environment variables
  validateEnvironment();

  // Initialize XMTP client
  const { client: xmtpClient } = await initializeXmtpClient();

  // Start listening for messages
  await startMessageListener(xmtpClient, handleMessage);
}

main().catch(console.error);