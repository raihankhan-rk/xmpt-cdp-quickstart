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

      const game = await gameManager.createGame(userId, amount);
      return `Game created!\nGame ID: ${game.id}\nBet Amount: ${game.betAmount} USDC\nTo join, send me: join ${game.id}`;
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
      
      if (updatedGame.status === "READY") {
        const result = await gameManager.executeCoinToss(gameId);
        
        return `Game joined and completed!\n\nCoin toss result: ${result.winner === userId ? "You won!" : "You lost!"}\nWinner: ${result.winner}\n\nWinnings have been transferred to the winner's wallet.`;
      }
      
      return `Successfully joined game ${gameId}. Payment of ${game.betAmount} USDC sent. Waiting for another player.`;
    }

    case "list": {
      const games = await gameManager.listActiveGames();
      if (games.length === 0) {
        return "No active games found.";
      }

      // Fix the type issue by making sure each iteration returns a string
      const gameDescriptions = games.map(
        (game) =>
          `Game ID: ${game.id}\nBet Amount: ${game.betAmount} USDC\nStatus: ${game.status}\nCreated by: ${game.creator}\nParticipants: ${game.participants.length}/2\nGame Wallet: ${game.walletAddress}`
      );
      
      return gameDescriptions.join("\n\n");
    }

    case "balance": {
      const balance = await gameManager.getUserBalance(userId);
      return `Your USDC balance: ${balance}`;
    }

    case "help":
      return `Available commands:
create <amount> - Create a new coin toss game with specified USDC bet amount
join <gameId> - Join an existing game with the specified ID
list - List all active games
balance - Check your wallet balance
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