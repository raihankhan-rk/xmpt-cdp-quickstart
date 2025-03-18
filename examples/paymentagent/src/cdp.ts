import {
  Coinbase,
  Wallet,
  Transfer,
  TimeoutError,
} from "@coinbase/coinbase-sdk";
import { keccak256, toHex, toBytes, isAddress } from "viem";
import { saveWalletData, getWalletData } from "./storage.js";

// Storage for wallet data
class WalletStorage {
  private storagePrefix: string;

  constructor(prefix: string = ".data/wallets") {
    this.storagePrefix = prefix;
  }

  async get(key: string): Promise<string | undefined> {
    try {
      const data = await getWalletData(key);
      return data ?? undefined;
    } catch (error) {
      console.error(`Error getting wallet data for ${key}:`, error);
      return undefined;
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      await saveWalletData(key, value);
    } catch (error) {
      console.error(`Error saving wallet data for ${key}:`, error);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await saveWalletData(key, "");
    } catch (error) {
      console.error(`Error deleting wallet data for ${key}:`, error);
    }
  }
}

// Initialize Coinbase SDK
function initializeCoinbaseSDK(): boolean {
  const coinbaseApiKeyName = process.env.COINBASE_API_KEY_NAME || process.env.CDP_API_KEY_NAME;
  let coinbaseApiKeyPrivateKey = process.env.COINBASE_API_KEY_PRIVATE_KEY || process.env.CDP_API_KEY_PRIVATE_KEY;

  // Replace \\n with actual newlines if present in the private key
  if (coinbaseApiKeyPrivateKey) {
    coinbaseApiKeyPrivateKey = coinbaseApiKeyPrivateKey.replace(/\\n/g, "\n");
  }

  console.log("coinbaseApiKeyName:", coinbaseApiKeyName ? "Defined" : "Undefined");
  console.log("coinbaseApiKeyPrivateKey:", coinbaseApiKeyPrivateKey ? "Defined" : "Undefined");

  if (!coinbaseApiKeyName || !coinbaseApiKeyPrivateKey) {
    console.error("Either COINBASE_API_KEY_NAME/COINBASE_API_KEY_PRIVATE_KEY or CDP_API_KEY_NAME/CDP_API_KEY_PRIVATE_KEY must be set");
    return false;
  }

  try {
    Coinbase.configure({ 
      apiKeyName: coinbaseApiKeyName, 
      privateKey: coinbaseApiKeyPrivateKey,
    });
    console.log("Coinbase SDK initialized successfully");
    return true;
  } catch (error) {
    console.error("Failed to initialize Coinbase SDK:", error);
    return false;
  }
}

// Agent wallet data
export type AgentWalletData = {
  id: string;
  wallet: any;
  address: string;
  agent_address: string;
  blockchain?: string;
  state?: string;
  key: string;
};

// Wallet service class based on cointoss implementation
export class WalletService {
  private walletStorage: WalletStorage;
  private cdpEncryptionKey: string;
  private senderAddress: string;
  private sdkInitialized: boolean;

  constructor(sender: string) {
    this.sdkInitialized = initializeCoinbaseSDK();
    
    this.walletStorage = new WalletStorage(".data/wallets");
    // Use either KEY or ENCRYPTION_KEY environment variable for local wallet encryption
    this.cdpEncryptionKey = (process.env.KEY || process.env.ENCRYPTION_KEY || "").toLowerCase();
    this.senderAddress = sender.toLowerCase();
    console.log(
      "WalletService initialized with sender",
      this.senderAddress
    );
  }

  encrypt(data: any): string {
    if (typeof data === "string") {
      data = data.toLowerCase();
    }
    const dataString = JSON.stringify(data);
    const key = keccak256(toHex(this.cdpEncryptionKey));
    // Simple XOR encryption with the key
    const encrypted = Buffer.from(dataString).map(
      (byte, i) => byte ^ parseInt(key.slice(2 + (i % 64), 4 + (i % 64)), 16),
    );
    return toHex(encrypted).toLowerCase();
  }

  decrypt(data: string): any | undefined {
    if (typeof data === "string") {
      data = data.toLowerCase();
    }
    const key = keccak256(toHex(this.cdpEncryptionKey));
    const encrypted = toBytes(data);
    const decrypted = encrypted.map(
      (byte, i) => byte ^ parseInt(key.slice(2 + (i % 64), 4 + (i % 64)), 16),
    );
    return JSON.parse(Buffer.from(decrypted).toString());
  }

  async createWallet(key: string): Promise<AgentWalletData> {
    try {
      key = key.toLowerCase();
      console.log(`Creating new wallet for key ${key}...`);
      
      // Initialize SDK if not already done
      if (!this.sdkInitialized) {
        this.sdkInitialized = initializeCoinbaseSDK();
      }
      
      // Log the network we're using
      console.log(`Creating wallet on network: ${Coinbase.networks.BaseSepolia}`);
      
      // Create wallet
      const wallet = await Wallet.create({
        networkId: Coinbase.networks.BaseSepolia,
      }).catch(err => {
        console.error("Detailed wallet creation error:", JSON.stringify(err, null, 2));
        throw err;
      });

      if (!wallet) {
        throw new Error("Failed to create wallet: Wallet object is undefined");
      }

      console.log("Wallet created successfully, exporting data...");
      const data = wallet.export();
      
      console.log("Getting default address...");
      const address = await wallet.getDefaultAddress();
      const walletAddress = address.getId();
      
      // Make the wallet address visible in the logs for funding
      console.log("-----------------------------------------------------");
      console.log(`NEW WALLET CREATED FOR USER: ${key}`);
      console.log(`WALLET ADDRESS: ${walletAddress}`);
      console.log(`NETWORK: ${Coinbase.networks.BaseSepolia}`);
      console.log(`SEND FUNDS TO THIS ADDRESS TO TEST: ${walletAddress}`);
      console.log("-----------------------------------------------------");

      const walletInfo = {
        data,
        agent_address: walletAddress,
        address: this.senderAddress,
        key,
      };

      console.log("Saving wallet data to storage...");
      await this.walletStorage.set(
        `wallet:${this.encrypt(key)}`,
        this.encrypt(walletInfo),
      );

      console.log("Wallet created and saved successfully");
      return {
        id: walletAddress,
        wallet: wallet,
        address: this.senderAddress,
        agent_address: walletAddress,
        key: key,
      };
    } catch (error) {
      console.error("Failed to create wallet:", error);
      
      // Provide more detailed error information
      if (error instanceof Error) {
        throw new Error(`Wallet creation failed: ${error.message}`);
      }
      
      throw new Error(`Failed to create wallet: ${String(error)}`);
    }
  }

  async getWallet(
    key: string,
    createIfNotFound: boolean = true,
  ): Promise<AgentWalletData | undefined> {
    console.log("Getting wallet for:", key);
    key = key.toLowerCase();
    const encryptedKey = `wallet:${this.encrypt(key)}`;
    const walletData = await this.walletStorage.get(encryptedKey);
    
    // If no wallet exists, create one
    if (!walletData) {
      console.log("No wallet found for", key);
      if (createIfNotFound) {
        console.log("Creating new wallet as none was found");
        try {
          const wallet = await this.createWallet(key);
          console.log("Successfully created new wallet, returning wallet data");
          return wallet;
        } catch (error) {
          console.error("Failed to create wallet in getWallet:", error);
          throw error;
        }
      }
      return undefined;
    }

    try {
      console.log("Found existing wallet data, decrypting...");
      const decrypted = this.decrypt(walletData);
      
      console.log("Importing wallet from stored data...");
      const importedWallet = await Wallet.import(decrypted.data)
        .catch(err => {
          console.error("Error importing wallet:", err);
          throw new Error(`Failed to import wallet: ${err.message}`);
        });
      
      console.log("Wallet imported successfully");
      return {
        id: importedWallet.getId() ?? "",
        wallet: importedWallet,
        agent_address: decrypted.agent_address,
        address: decrypted.address,
        key: decrypted.key,
      };
    } catch (error) {
      console.error("Failed to decrypt or import wallet data:", error);
      
      // If we failed to import, but have wallet data, attempt to recreate
      if (createIfNotFound) {
        console.log("Attempting to recreate wallet after import failure");
        return this.createWallet(key);
      }
      
      throw new Error("Invalid wallet access");
    }
  }

  async checkBalance(
    humanAddress: string,
  ): Promise<{ address: string | undefined; balance: number }> {
    humanAddress = humanAddress.toLowerCase();
    console.log(`⚖️ Checking balance for user: ${humanAddress}...`);
    
    const walletData = await this.getWallet(humanAddress);
    if (!walletData) {
      console.log(`❌ No wallet found for ${humanAddress}`);
      return { address: undefined, balance: 0 };
    }

    console.log(`✅ Retrieved wallet with address: ${walletData.agent_address} for user: ${humanAddress}`);
    
    try {
      console.log(`💰 Fetching USDC balance for address: ${walletData.agent_address}...`);
      const balance = await walletData.wallet.getBalance(Coinbase.assets.Usdc);
      console.log(`💵 USDC Balance for ${humanAddress}: ${Number(balance)} USDC`);
      
      return {
        address: walletData.agent_address,
        balance: Number(balance),
      };
    } catch (error) {
      console.error(`❌ Error getting balance for ${humanAddress}:`, error);
      return {
        address: walletData.agent_address,
        balance: 0
      };
    }
  }

  async transfer(
    fromAddress: string,
    toAddress: string,
    amount: number,
  ): Promise<Transfer | undefined> {
    fromAddress = fromAddress.toLowerCase();
    toAddress = toAddress.toLowerCase();
    
    console.log("📤 TRANSFER INITIATED");
    console.log(`💸 Amount: ${amount} USDC`);
    console.log(`🔍 From user: ${fromAddress}`);
    console.log(`🔍 To: ${toAddress}`);
    
    // Get the source wallet
    console.log(`🔑 Retrieving source wallet for user: ${fromAddress}...`);
    const from = await this.getWallet(fromAddress);
    if (!from) {
      console.error(`❌ No wallet found for sender: ${fromAddress}`);
      return undefined;
    }
    console.log(`✅ Source wallet found: ${from.agent_address}`);
    
    if (!Number(amount)) {
      console.error(`❌ Invalid amount: ${amount}`);
      return undefined;
    }

    // Check balance
    console.log(`💰 Checking balance for source wallet: ${from.agent_address}...`);
    const balance = await from.wallet.getBalance(Coinbase.assets.Usdc);
    console.log(`💵 Available balance: ${Number(balance)} USDC`);
    
    if (Number(balance) < amount) {
      console.error(`❌ Insufficient balance. Required: ${amount} USDC, Available: ${Number(balance)} USDC`);
      return undefined;
    }

    if (!isAddress(toAddress) && !toAddress.includes(":")) {
      // If this is not an address, and not a user ID, we can't transfer
      console.error(`❌ Invalid destination address: ${toAddress}`);
      return undefined;
    }

    // Get or validate destination wallet
    let destinationAddress = toAddress;
    console.log(`🔑 Validating destination: ${toAddress}...`);
    const to = await this.getWallet(toAddress, false);
    if (to) {
      destinationAddress = to.agent_address;
      console.log(`✅ Destination wallet found: ${destinationAddress}`);
    } else {
      console.log(`ℹ️ Using raw address as destination: ${destinationAddress}`);
    }
    
    if (destinationAddress.includes(":")) {
      console.error(`❌ Invalid destination address format: ${destinationAddress}`);
      return undefined;
    }

    try {
      console.log(`🚀 Executing transfer of ${amount} USDC from ${from.agent_address} to ${destinationAddress}...`);
      const transfer = await from.wallet.createTransfer({
        amount,
        assetId: Coinbase.assets.Usdc,
        destination: destinationAddress as string,
        gasless: true,
      });
      
      console.log(`⏳ Waiting for transfer to complete...`);
      try {
        await transfer.wait();
        console.log(`✅ Transfer completed successfully!`);
        console.log(`📝 Transaction details: ${JSON.stringify(transfer, null, 2)}`);
      } catch (err) {
        if (err instanceof TimeoutError) {
          console.log(`⚠️ Waiting for transfer timed out, but transaction may still complete`);
        } else {
          console.error(`❌ Error while waiting for transfer to complete:`, err);
        }
      }

      return transfer;
  } catch (error) {
      console.error(`❌ Transfer failed:`, error);
      throw error;
    }
  }
} 