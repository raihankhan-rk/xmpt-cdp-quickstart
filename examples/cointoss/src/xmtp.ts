import { Client, type Signer, type XmtpEnv } from "@xmtp/node-sdk";
import { IdentifierKind } from "@xmtp/node-bindings";
import { fromString } from "uint8arrays";
import { createWalletClient, http, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

/**
 * Create a viem signer from a wallet private key
 * @param walletKey - Wallet private key as a hex string
 * @returns A signer object compatible with XMTP
 */
export const createSigner = (walletKey: string): Signer => {
  const account = privateKeyToAccount(walletKey as `0x${string}`);
  const wallet = createWalletClient({
    account,
    chain: sepolia,
    transport: http(),
  });

  return {
    type: "EOA" as const,
    getIdentifier: () => ({
      identifierKind: IdentifierKind.Ethereum,
      identifier: account.address.toLowerCase(),
    }),
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
 * Initialize the XMTP client
 */
export async function initializeXmtpClient() {
  const { WALLET_KEY, ENCRYPTION_KEY } = process.env;

  if (!WALLET_KEY || !ENCRYPTION_KEY) {
    throw new Error("WALLET_KEY and ENCRYPTION_KEY must be set in environment variables");
  }

  // Create the signer using viem
  const signer = createSigner(WALLET_KEY);
  const encryptionKey = getEncryptionKeyFromHex(ENCRYPTION_KEY);

  // Set the environment to dev or production
  const env: XmtpEnv = process.env.XMTP_ENV as XmtpEnv || "dev";

  console.log(`Creating XMTP client on the '${env}' network...`);
  const client = await Client.create(signer, encryptionKey, { env });

  console.log("Syncing conversations...");
  await client.conversations.sync();

  const identifier = await signer.getIdentifier();

  console.log(
    `CoinToss Agent initialized on ${identifier.identifier}\nSend a message on http://xmtp.chat/dm/${identifier.identifier}?env=${env}`
  );

  return { client, env };
}

export type MessageHandler = (message: any, conversation: any, userId: string, content: string) => Promise<void>;

/**
 * Check if the message is tagged for the toss bot
 * @param content Message content
 * @returns True if the message is tagged for toss bot
 */
function isMessageForTossBot(content: string): boolean {
  const lowerContent = content.toLowerCase().trim();
  return lowerContent.startsWith('@toss');
}

/**
 * Strip tag from message content
 * @param content Message content
 * @returns Message content without tag
 */
function stripTag(content: string): string {
  // Remove @toss from the beginning and trim
  return content.replace(/^@toss\s*/i, '').trim();
}

/**
 * Start listening for messages and handle them with the provided handler
 */
export async function startMessageListener(client: Client, handleMessage: MessageHandler) {
  console.log("Waiting for messages...");
  const stream = client.conversations.streamAllMessages();

  for await (const message of await stream) {
    // Ignore messages from the same agent or non-text messages
    if (
      message?.senderInboxId.toLowerCase() === client.inboxId.toLowerCase() ||
      message?.contentType?.typeId !== "text"
    ) {
      continue;
    }

    const content = message.content as string;
    
    // Only process messages that tag @toss
    if (!isMessageForTossBot(content)) {
      console.log(`Ignoring message not tagged for toss bot: ${content}`);
      continue;
    }

    const strippedContent = stripTag(content);
    console.log(`Received message for toss bot: ${strippedContent} from ${message.senderInboxId}`);

    // Get the conversation
    const conversation = await client.conversations.getConversationById(
      message.conversationId
    );

    if (!conversation) {
      console.log("Unable to find conversation, skipping");
      continue;
    }

    // Check if this is a group chat
    const isGroup = 'members' in conversation;
    console.log(`Conversation is${isGroup ? '' : ' not'} a group chat`);

    // Handle the message
    await handleMessage(message, conversation, message.senderInboxId, strippedContent);
  }
} 