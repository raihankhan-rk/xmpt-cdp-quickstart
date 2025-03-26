import {
  AgentKit,
  CdpWalletProvider,
} from "@coinbase/agentkit";
import { getLangChainTools } from "@coinbase/agentkit-langchain";
import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { usdcActionProvider } from "./action.js";
import { initializeStorage, saveWalletData, getWalletData } from "./storage.js";

// Initialize storage
initializeStorage();

// Global stores for memory and agent instances
const memoryStore: Record<string, MemorySaver> = {};
const agentStore: Record<string, Agent> = {};

interface AgentConfig {
  configurable: {
    thread_id: string;
  };
}

type Agent = ReturnType<typeof createReactAgent>;

/**
 * Initialize the agent with CDP Agentkit
 * @param userId - The user's identifier (XMTP address)
 * @returns Agent executor and config
 */
export async function initializeAgent(
  userId: string
): Promise<{ agent: Agent; config: AgentConfig }> {
  try {
    // Check if we already have an agent for this user
    if (agentStore[userId]) {
      console.log(`Using existing agent for user: ${userId}`);
      const agentConfig = {
        configurable: { thread_id: userId },
      };
      return { agent: agentStore[userId], config: agentConfig };
    }

    console.log(`Creating new agent for user: ${userId}`);

    // Initialize LLM
    const llm = new ChatOpenAI({
      model: "gpt-4o-mini",
    });

    // Get stored wallet data
    const storedWalletData = await getWalletData(userId);
    console.log(`Wallet data for ${userId}: ${storedWalletData ? "Found" : "Not found"}`);

    // Configure CDP Wallet Provider
    const config = {
      apiKeyName: process.env.CDP_API_KEY_NAME,
      apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      cdpWalletData: storedWalletData || undefined,
      networkId: process.env.NETWORK_ID || "base-sepolia",
    };

    const walletProvider = await CdpWalletProvider.configureWithWallet(config);

    // Initialize AgentKit
    const agentkit = await AgentKit.from({
      walletProvider,
      actionProviders: [
        usdcActionProvider(),
      ],
    });

    const tools = await getLangChainTools(agentkit);

    // Get or create memory saver for this user
    if (!memoryStore[userId]) {
      console.log(`Creating new memory store for user: ${userId}`);
      memoryStore[userId] = new MemorySaver();
    } else {
      console.log(`Using existing memory store for user: ${userId}`);
    }

    const agentConfig: AgentConfig = {
      configurable: { thread_id: userId },
    };

    // Create React Agent using the LLM and CDP AgentKit tools
    const agent = createReactAgent({
      llm,
      tools,
      checkpointSaver: memoryStore[userId],
      messageModifier: `
        You are a DeFi Payment Agent that assists users with sending payments and managing their crypto assets.
        You can interact with the blockchain using Coinbase Developer Platform AgentKit.

        When a user asks you to make a payment or check their balance:
        1. Always check the wallet details first to see what network you're on
        2. If on base-sepolia testnet, you can request funds from the faucet if needed
        3. For mainnet operations, provide wallet details and request funds from the user

        Your default network is Base Sepolia testnet.
        Your primary token for transactions is USDC.

        You can only perform payment and wallet-related tasks. For other requests, politely explain that you're 
        specialized in processing payments and can't assist with other tasks.
                
        If you encounter an error:
        - For 5XX errors: Ask the user to try again later
        - For other errors: Provide clear troubleshooting advice and offer to retry
        
        Be concise, helpful, and security-focused in all your interactions.
      `,
    });

    // Store the agent for future use
    agentStore[userId] = agent;

    // Save wallet data to persistent storage
    const exportedWallet = await walletProvider.exportWallet();
    const walletDataJson = JSON.stringify(exportedWallet);
    await saveWalletData(userId, walletDataJson);
    console.log(`Wallet data saved for user ${userId}`);

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
export async function processMessage(
  agent: Agent,
  config: AgentConfig,
  message: string
): Promise<string> {
  let response = "";

  try {
    console.log(`Processing message for user: ${config.configurable.thread_id}`);
    const stream = await agent.stream(
      { messages: [new HumanMessage(message)] },
      config
    );

    for await (const chunk of stream) {
      if ("agent" in chunk) {
        response += chunk.agent.messages[0].content + "\n";
      }
    }

    return response.trim();
  } catch (error) {
    console.error("Error processing message:", error);
    return "Sorry, I encountered an error while processing your request. Please try again later.";
  }
} 