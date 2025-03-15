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
import { StorageProvider } from "./types.js";

export async function getOrCreateWalletForUser(
  userId: string,
  storage: StorageProvider
) {
  const walletDataStr = await storage.getUserWallet(userId);

  let walletProvider;

  // Configure CDP Wallet Provider
  const config = {
    apiKeyName: process.env.CDP_API_KEY_NAME!,
    apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    cdpWalletData: walletDataStr || undefined,
    networkId: process.env.NETWORK_ID,
  };

  // Create a new wallet if one doesn't exist
  walletProvider = await CdpWalletProvider.configureWithWallet(config);

  if (!walletDataStr) {
    // Export wallet data and save
    const exportedWallet = await walletProvider.exportWallet();
    await storage.saveUserWallet({
      userId,
      walletData: JSON.stringify(exportedWallet),
    });
  }

  return { walletProvider, config };
}

export async function createGameWallet(storage: StorageProvider) {
  const config = {
    apiKeyName: process.env.CDP_API_KEY_NAME!,
    apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    networkId: process.env.NETWORK_ID || "base-mainnet",
  };

  const walletProvider = await CdpWalletProvider.configureWithWallet(config);
  const exportedWallet = await walletProvider.exportWallet();

  return {
    walletProvider,
    walletAddress: await walletProvider.getAddress(),
    exportedWallet: JSON.stringify(exportedWallet),
  };
}

export async function initializeAgent(userId: string, storage: StorageProvider) {
  try {
    const llm = new ChatOpenAI({
      modelName: "gpt-4o-mini",
    });

    const { walletProvider, config: walletConfig } = await getOrCreateWalletForUser(
      userId,
      storage
    );

    const agentkit = await AgentKit.from({
      walletProvider,
      actionProviders: [
        walletActionProvider(),
        erc20ActionProvider(),
        cdpApiActionProvider({
          apiKeyName: process.env.CDP_API_KEY_NAME!,
          apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        }),
        cdpWalletActionProvider({
          apiKeyName: process.env.CDP_API_KEY_NAME!,
          apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        }),
      ],
    });

    const tools = await getLangChainTools(agentkit);
    const memory = new MemorySaver();

    const agentConfig = {
      configurable: { thread_id: `CoinToss Agent for ${userId}` },
    };

    const agent = createReactAgent({
      llm,
      tools: tools as any, // Type assertion to fix type error
      checkpointSaver: memory,
      messageModifier: `
        You are a CoinToss Agent that helps users participate in coin toss betting games.
        When checking payments or balances:
        1. Use the USDC token at 0x5dEaC602762362FE5f135FA5904351916053cF70 on Base.
        2. When asked to check if a payment was sent, verify:
           - The exact amount was transferred
           - The transaction is confirmed
           - The correct addresses were used
        3. For balance checks, show the exact USDC amount available.
        4. When transferring winnings, ensure:
           - The game wallet has sufficient balance
           - The transfer is completed successfully
           - Provide transaction details
        
        Available commands:
        /create <amount> - Create a new coin toss game with specified USDC bet amount
        /join <gameId> - Join an existing game with the specified ID
        /list - List all active games
        /balance - Check your wallet balance
        /help - Show available commands
        
        Before executing any action:
        1. Check if the user has sufficient balance for the requested action
        2. Verify game exists when joining
        3. Ensure proper game state transitions
        4. Handle any errors gracefully
        
        Keep responses concise and clear, focusing on payment verification and game status.
        If there is a 5XX (internal) HTTP error, ask the user to try again later.
      `,
    });

    return { agent, config: agentConfig };
  } catch (error) {
    console.error("Failed to initialize agent:", error);
    throw error;
  }
}

export async function processMessage(
  agent: ReturnType<typeof createReactAgent>,
  config: { configurable: { thread_id: string } },
  message: string
): Promise<string> {
  try {
    const stream = await agent.stream(
      { messages: [new HumanMessage(message)] },
      config
    );

    let response = "";
    for await (const chunk of stream) {
      if ("agent" in chunk) {
        response += chunk.agent.messages[0].content + "\n";
      } else if ("tools" in chunk) {
        response += chunk.tools.messages[0].content + "\n";
      }
    }

    return response.trim();
  } catch (error) {
    console.error("Error processing message:", error);
    return "Sorry, I encountered an error while processing your request. Please try again.";
  }
} 