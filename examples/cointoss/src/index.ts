import * as dotenv from "dotenv";
import { LocalStorageProvider, RedisStorageProvider } from "./storage.js";
import { GameManager } from "./game.js";
import { initializeAgent, processMessage } from "./cdp.js";
import { initializeXmtpClient, startMessageListener } from "./xmtp.js";
import { GameStatus } from "./types.js";

// Initialize environment variables
dotenv.config();

/**
 * Validates that required environment variables are set
 */
function validateEnvironment(): void {
  const missingVars: string[] = [];

  // Check required variables
  const requiredVars = [
    "OPENAI_API_KEY",
    "CDP_API_KEY_NAME",
    "CDP_API_KEY_PRIVATE_KEY",
    "WALLET_KEY",
    "ENCRYPTION_KEY",
  ];

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

  // Warn about optional variables
  if (!process.env.NETWORK_ID) {
    console.warn(
      "Warning: NETWORK_ID not set, defaulting to base-mainnet"
    );
  }

  if (!process.env.REDIS_URL) {
    console.warn(
      "Warning: REDIS_URL not set, using local file storage for wallet data"
    );
  }
}

/**
 * Handle incoming messages
 */
async function handleMessage(message: any, conversation: any) {
  // Initialize storage provider (Redis if REDIS_URL is set, otherwise local)
  const storage = process.env.REDIS_URL
    ? new RedisStorageProvider()
    : new LocalStorageProvider();

  const gameManager = new GameManager(storage);

  // Use the sender's address as the user ID
  const userId = message.senderInboxId;

  try {
    // Initialize agent for this user
    const { agent, config } = await initializeAgent(userId, storage);

    // Process the message content
    const content = message.content as string;
    const response = await handleCommand(
      content,
      userId,
      gameManager,
      agent,
      config
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

async function verifyPayment(
  agent: any,
  config: any,
  amount: string,
  gameWallet: string
): Promise<boolean> {
  // First check USDC balance of game wallet
  const balanceResponse = await processMessage(
    agent,
    config,
    `Check USDC balance of ${gameWallet}`
  );
  console.log("balanceResponse: ", balanceResponse);

  // Extract balance from response
  const balanceMatch = balanceResponse.match(/(\d+(\.\d+)?)/);
  if (!balanceMatch) {
    return false;
  }

  const balance = parseFloat(balanceMatch[0]);
  const requiredAmount = parseFloat(amount);

  // Verify the game wallet has received the payment
  return balance >= requiredAmount;
}

async function handleCommand(
  content: string,
  userId: string,
  gameManager: GameManager,
  agent: any,
  config: any
): Promise<string> {
  const [command, ...args] = content.split(" ");

  switch (command.toLowerCase()) {
    case "/create": {
      const amount = args[0];
      if (!amount) {
        return "Please specify a bet amount: /create <amount>";
      }

      // Check if user has sufficient balance first
      const balanceResponse = await processMessage(
        agent,
        config,
        "what is my wallet address"
      );
      console.log("user balanceResponse: ", balanceResponse);
      const balanceMatch = balanceResponse.match(/(\d+(\.\d+)?)/);
      if (!balanceMatch || parseFloat(balanceMatch[0]) < parseFloat(amount)) {
        return `Insufficient USDC balance. You need at least ${amount} USDC to create a game.`;
      }

      const game = await gameManager.createGame(userId, amount);
      return `Game created!\nGame ID: ${game.id}\nBet Amount: ${game.betAmount} USDC\nTo join, send ${game.betAmount} USDC to ${game.walletAddress} and then use /join ${game.id}`;
    }

    case "/join": {
      const gameId = args[0];
      if (!gameId) {
        return "Please specify a game ID: /join <gameId>";
      }

      // First check if the game exists and is joinable
      const game = await gameManager.joinGame(gameId, userId);
      
      // Check user's balance first
      const balanceResponse = await processMessage(
        agent,
        config,
        "Check my USDC balance"
      );
      console.log("user balanceResponse: ", balanceResponse);

      const balanceMatch = balanceResponse.match(/(\d+(\.\d+)?)/);
      if (!balanceMatch || parseFloat(balanceMatch[0]) < parseFloat(game.betAmount)) {
        return `Insufficient USDC balance. You need ${game.betAmount} USDC to join this game.`;
      }

      // Try to send the payment
      const sendResponse = await processMessage(
        agent,
        config,
        `Send ${game.betAmount} USDC to ${game.walletAddress}`
      );

      // Verify the payment was successful
      const hasPaid = await verifyPayment(agent, config, game.betAmount, game.walletAddress);
      if (!hasPaid) {
        return `Payment failed or not confirmed yet. Please ensure you have sent ${game.betAmount} USDC to ${game.walletAddress} and try again.`;
      }

      // Add player to game after payment confirmation
      const updatedGame = await gameManager.addPlayerToGame(gameId, userId, true);
      
      if (updatedGame.status === GameStatus.READY) {
        const result = await gameManager.executeCoinToss(gameId);
        
        // Transfer winnings to the winner
        const winAmount = (parseFloat(result.betAmount) * 2).toString();
        const transferResponse = await processMessage(
          agent,
          config,
          `Transfer ${winAmount} USDC from ${result.walletAddress} to ${result.winner}`
        );

        return `Game joined and completed!\n${sendResponse}\n\nCoin toss result: ${result.winner === userId ? "You won!" : "You lost!"}\nWinner: ${result.winner}\n\nPayout: ${transferResponse}`;
      }
      
      return `Successfully joined game ${gameId}. ${sendResponse}\nWaiting for another player.`;
    }

    case "/list": {
      const games = await gameManager.listActiveGames();
      if (games.length === 0) {
        return "No active games found.";
      }

      return games
        .map(
          (game) =>
            `Game ID: ${game.id}\nBet Amount: ${game.betAmount} USDC\nStatus: ${game.status}\nCreated by: ${game.creator}\nParticipants: ${game.participants.length}/2\nGame Wallet: ${game.walletAddress}`
        )
        .join("\n\n");
    }

    case "/balance": {
      return processMessage(agent, config, "Check my USDC balance");
    }

    case "/help":
      return `Available commands:
/create <amount> - Create a new coin toss game with specified USDC bet amount
/join <gameId> - Join an existing game with the specified ID (requires sending USDC first)
/list - List all active games
/balance - Check your wallet balance
/help - Show this help message`;

    default:
      return "Unknown command. Type /help to see available commands.";
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