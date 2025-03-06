import * as fs from "fs";
import {
  AgentKit,
  cdpApiActionProvider,
  cdpWalletActionProvider,
  CdpWalletProvider,
  erc20ActionProvider,
  walletActionProvider,
} from "@coinbase/agentkit";
import { getLangChainTools } from "@coinbase/agentkit-langchain";
import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { Client, type XmtpEnv } from "@xmtp/node-sdk";
import * as dotenv from "dotenv";
import { createClient } from "redis";
import * as nodeCrypto from "crypto";
import { fromString } from "uint8arrays";
import { createWalletClient, http, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

// Initialize environment variables
dotenv.config();

/**
 * Create a viem signer from a wallet private key
 * @param walletKey - Wallet private key as a hex string
 * @returns A signer object compatible with XMTP
 */
function createSigner(walletKey: string) {
  const account = privateKeyToAccount(walletKey as `0x${string}`);
  const wallet = createWalletClient({
    account,
    chain: sepolia,
    transport: http(),
  });

  return {
    walletType: "EOA" as const,
    getAddress: () => account.address,
    signMessage: async (message: string) => {
      const signature = await wallet.signMessage({
        message,
        account,
      });
      return toBytes(signature);
    },
  };
}

/**
 * Convert hex encryption key to appropriate format for XMTP
 * @param key - Encryption key as a hex string
 * @returns Encryption key bytes
 */
function getEncryptionKeyFromHex(key: string): Uint8Array {
  // Remove 0x prefix if present
  const hexString = key.startsWith("0x") ? key.slice(2) : key;
  return fromString(hexString, "hex");
}

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
      "Warning: NETWORK_ID not set, defaulting to base-sepolia testnet",
    );
  }

  if (!process.env.REDIS_URL) {
    console.warn(
      "Warning: REDIS_URL not set, using local file storage for wallet data",
    );
  }
}

validateEnvironment();

// Storage constants
const WALLET_KEY_PREFIX = "wallet_data:";
const LOCAL_STORAGE_DIR = "./wallet_data";
let redisClient: any = null;

// Set up Redis client if URL is provided
if (process.env.REDIS_URL) {
  redisClient = createClient({
    url: process.env.REDIS_URL,
  });

  // Connect to Redis
  redisClient
    .connect()
    .then(() => {
      console.log("Connected to Redis");
    })
    .catch((err: any) => {
      console.error("Failed to connect to Redis:", err);
      console.log("Falling back to local file storage");
      redisClient = null;

      // Create local storage directory if it doesn't exist
      if (!fs.existsSync(LOCAL_STORAGE_DIR)) {
        fs.mkdirSync(LOCAL_STORAGE_DIR, { recursive: true });
      }
    });
} else {
  // Create local storage directory if it doesn't exist
  if (!fs.existsSync(LOCAL_STORAGE_DIR)) {
    fs.mkdirSync(LOCAL_STORAGE_DIR, { recursive: true });
  }
  console.log("Using local file storage for wallet data");
}

/**
 * Initialize the XMTP client
 */
async function initializeXmtpClient() {
  const { WALLET_KEY, ENCRYPTION_KEY } = process.env;

  // Create the signer using viem
  const signer = createSigner(WALLET_KEY!);
  const encryptionKey = getEncryptionKeyFromHex(ENCRYPTION_KEY!);

  // Set the environment to dev or production
  const env: XmtpEnv = "dev";

  console.log(`Creating XMTP client on the '${env}' network...`);
  const client = await Client.create(signer, encryptionKey, { env });

  console.log("Syncing conversations...");
  await client.conversations.sync();

  console.log(
    `Agent initialized on ${client.accountAddress}\nSend a message on http://xmtp.chat/dm/${client.accountAddress}?env=${env}`,
  );

  return { client, env };
}

/**
 * Get or create wallet data for a user
 * @param userId - The user's identifier (XMTP address)
 * @returns The wallet data and provider
 */
async function getOrCreateWalletForUser(userId: string) {
  let walletDataStr: string | null = null;
  const redisKey = `${WALLET_KEY_PREFIX}${userId}`;
  const localFilePath = `${LOCAL_STORAGE_DIR}/${userId}.json`;

  // Try to get existing wallet data
  if (redisClient && redisClient.isReady) {
    // Get from Redis if available
    walletDataStr = await redisClient.get(redisKey);
  } else {
    // Get from local file if Redis is not available
    try {
      if (fs.existsSync(localFilePath)) {
        walletDataStr = fs.readFileSync(localFilePath, "utf8");
      }
    } catch (error) {
      console.warn(`Could not read wallet data from file: ${error}`);
    }
  }

  let walletProvider;

  // Configure CDP Wallet Provider
  const config = {
    apiKeyName: process.env.CDP_API_KEY_NAME!,
    apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(
      /\\n/g,
      "\n",
    ),
    cdpWalletData: walletDataStr || undefined,
    networkId: process.env.NETWORK_ID || "base-sepolia",
  };

  // Create a new wallet if one doesn't exist
  if (!walletDataStr) {
    walletProvider = await CdpWalletProvider.configureWithWallet(config);

    // Export wallet data and save
    const exportedWallet = await walletProvider.exportWallet();
    const exportedWalletStr = JSON.stringify(exportedWallet);

    if (redisClient && redisClient.isReady) {
      // Save to Redis
      await redisClient.set(redisKey, exportedWalletStr);
    } else {
      // Save to local file
      try {
        fs.writeFileSync(localFilePath, exportedWalletStr);
      } catch (error) {
        console.error(`Failed to save wallet data to file: ${error}`);
      }
    }
  } else {
    walletProvider = await CdpWalletProvider.configureWithWallet(config);
  }

  return { walletProvider, config };
}

// Define types for agent and configuration
interface AgentConfig {
  configurable: {
    thread_id: string;
  };
}

// Type for the agent
type Agent = ReturnType<typeof createReactAgent>;

/**
 * Initialize the agent with CDP Agentkit
 * @param userId - The user's identifier (XMTP address)
 * @returns Agent executor and config
 */
async function initializeAgent(
  userId: string,
): Promise<{ agent: Agent; config: AgentConfig }> {
  try {
    // Initialize LLM
    const llm = new ChatOpenAI({
      model: "gpt-4o-mini",
    });

    // Get or create wallet provider for the user
    const { walletProvider, config: walletConfig } =
      await getOrCreateWalletForUser(userId);

    // Initialize AgentKit with payment-focused action providers
    const agentkit = await AgentKit.from({
      walletProvider,
      actionProviders: [
        walletActionProvider(),
        erc20ActionProvider(),
        cdpApiActionProvider({
          apiKeyName: process.env.CDP_API_KEY_NAME!,
          apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(
            /\\n/g,
            "\n",
          ),
        }),
        cdpWalletActionProvider({
          apiKeyName: process.env.CDP_API_KEY_NAME!,
          apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(
            /\\n/g,
            "\n",
          ),
        }),
      ],
    });

    const tools = await getLangChainTools(agentkit);

    // Store buffered conversation history in memory
    const memory = new MemorySaver();
    const agentConfig: AgentConfig = {
      configurable: { thread_id: `Payment Agent for ${userId}` },
    };

    // Create React Agent using the LLM and CDP AgentKit tools
    const agent = createReactAgent({
      llm,
      tools,
      checkpointSaver: memory,
      messageModifier: `
        You are a DeFi Payment Agent that assists users with sending payments to any wallet address using natural language instructions.

        When a user asks you to make a payment:
        1. Always confirm the payment details before proceeding.
        2. Provide clear information about network fees and transaction status.
        3. Notify users of successful transactions with relevant details.
        
        You can only perform payment-related tasks. For other requests, politely explain that you're 
        specialized in processing payments and can't assist with other tasks.
        
        If you encounter an error, provide clear troubleshooting advice and offer to retry the transaction.
        
        Before executing your first action, get the wallet balance to see how much funds you have.
        If you don't have enough funds, ask the user to deposit more funds into your wallet and provide them your wallet address.
        You're on the base-sepolia testnet, where you can request funds from a faucet if needed.
        
        If there is a 5XX (internal) HTTP error, ask the user to try again later.
        
        Be concise, helpful, and security-focused in all your interactions.
      `,
    });

    // Export and save updated wallet data
    const exportedWallet = await walletProvider.exportWallet();
    const exportedWalletStr = JSON.stringify(exportedWallet);
    const redisKey = `${WALLET_KEY_PREFIX}${userId}`;
    const localFilePath = `${LOCAL_STORAGE_DIR}/${userId}.json`;

    if (redisClient && redisClient.isReady) {
      // Save to Redis
      await redisClient.set(redisKey, exportedWalletStr);
    } else {
      // Save to local file
      try {
        fs.writeFileSync(localFilePath, exportedWalletStr);
      } catch (error) {
        console.error(`Failed to save wallet data to file: ${error}`);
      }
    }

    return { agent, config: agentConfig };
  } catch (error) {
    console.error("Failed to initialize agent:", error);
    throw error;
  }
}

/**
 * Process a message with the agent
 * @param agent - The agent executor
 * @param config - Agent configuration
 * @param message - The user message
 * @returns The agent's response
 */
async function processMessage(
  agent: Agent,
  config: AgentConfig,
  message: string,
): Promise<string> {
  let response = "";

  try {
    const stream = await agent.stream(
      { messages: [new HumanMessage(message)] },
      config,
    );

    for await (const chunk of stream) {
      if ("agent" in chunk) {
        response += chunk.agent.messages[0].content + "\n";
      } else if ("tools" in chunk) {
        // Tool execution messages can be added to the response or handled separately
        // For now, we'll add them to provide transparency
        response += chunk.tools.messages[0].content + "\n";
      }
    }

    return response.trim();
  } catch (error) {
    console.error("Error processing message:", error);
    return "Sorry, I encountered an error while processing your request. Please try again later.";
  }
}

async function main(): Promise<void> {
  try {
    console.log("Starting Payment Agent...");

    // Connect to Redis if available
    if (redisClient) {
      try {
        await redisClient.connect();
        console.log("Connected to Redis");
      } catch (error) {
        console.error("Failed to connect to Redis:", error);
        console.log("Falling back to local file storage");
        redisClient = null;

        // Create local storage directory if it doesn't exist
        if (!fs.existsSync(LOCAL_STORAGE_DIR)) {
          fs.mkdirSync(LOCAL_STORAGE_DIR, { recursive: true });
        }
      }
    }

    // Initialize XMTP client
    const { client: xmtpClient, env } = await initializeXmtpClient();

    console.log("Waiting for messages...");
    const stream = xmtpClient.conversations.streamAllMessages();

    // Use a controlled loop instead of while(true)
    let isRunning = true;

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      console.log("Received SIGINT, shutting down gracefully...");
      isRunning = false;
    });

    while (isRunning) {
      try {
        for await (const message of await stream) {
          // Ignore messages from the same agent or non-text messages
          if (
            message?.senderInboxId.toLowerCase() ===
              xmtpClient.inboxId.toLowerCase() ||
            message?.contentType?.typeId !== "text"
          ) {
            continue;
          }

          console.log(
            `Received message: ${message.content as string} by ${message.senderInboxId}`,
          );

          // Get the conversation
          const conversation = xmtpClient.conversations.getConversationById(
            message.conversationId,
          );

          if (!conversation) {
            console.log("Unable to find conversation, skipping");
            continue;
          }

          // Use the sender's address as the user ID
          const userId = message.senderInboxId;

          // Initialize or get the agent for this user
          const { agent, config } = await initializeAgent(userId);

          // Process the message with the agent
          const response = await processMessage(
            agent,
            config,
            message.content as string,
          );

          // Send the response back to the user
          console.log(`Sending response to ${userId}...`);
          await conversation.send(response);

          console.log("Waiting for more messages...");
        }
      } catch (streamError) {
        console.error("Stream error, reconnecting:", streamError);
        // Wait a bit before reconnecting
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // Check if we should continue running
        if (!isRunning) break;
      }
    }
  } catch (error: unknown) {
    console.error("Fatal error:", error);
    process.exit(1);
  } finally {
    // Close Redis connection when done
    if (redisClient) {
      await redisClient.disconnect();
    }
  }
}

// Start the agent
main().catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
