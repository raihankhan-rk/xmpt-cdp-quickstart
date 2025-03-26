/**
 * USDC Action Provider
 *
 * This file contains the implementation of the UsdcActionProvider,
 * which provides actions for USDC balance checking and transfers.
 *
 * @module usdc
 */

import { z } from "zod";
import { ActionProvider, CreateAction, Network } from "@coinbase/agentkit";
import { CdpWalletProvider } from "@coinbase/agentkit";
import { Coinbase, TimeoutError } from "@coinbase/coinbase-sdk";
import { isAddress } from "viem";
import { Wallet } from "@coinbase/coinbase-sdk";

/**
 * USDC Balance check action schema
 */
export const UsdcBalanceSchema = z.object({});

/**
 * USDC Transfer action schema
 */
export const UsdcTransferSchema = z.object({
  /**
   * The recipient address (must be a valid Ethereum address)
   */
  recipientAddress: z.string()
    .refine(val => isAddress(val), { 
      message: "Must be a valid Ethereum address" 
    }),

  /**
   * The amount to transfer (as a decimal string, e.g. '0.01')
   */
  amount: z.string()
    .regex(/^\d*\.?\d+$/, "Amount must be a valid decimal number"),
});

/**
 * UsdcActionProvider provides actions for USDC balance checking and transfers.
 *
 * @description
 * This provider is designed to work with CdpWalletProvider for USDC operations.
 * It supports Base Sepolia testnet.
 */
export class UsdcActionProvider extends ActionProvider<CdpWalletProvider> {
  /**
   * Constructor for the UsdcActionProvider.
   */
  constructor() {
    super("usdc", []);
  }

  /**
   * Get USDC balance for the current wallet
   *
   * @description
   * Checks the USDC balance of the current wallet
   *
   * @param walletProvider - The wallet provider instance for blockchain interactions
   * @returns A promise that resolves to a string with the wallet address and USDC balance
   */
  @CreateAction({
    name: "get_usdc_balance",
    description: `
      Check the USDC balance of the current wallet.
      
      This action returns the wallet address and current USDC balance.
      No parameters are required.
      
      Returns:
      - The wallet address
      - The USDC balance in decimal format
    `,
    schema: UsdcBalanceSchema,
  })
  async getUsdcBalance(
    walletProvider: CdpWalletProvider,
  ): Promise<string> {
    try {
      const address = walletProvider.getAddress();
      console.log(`⚖️ Checking USDC balance for address: ${address}...`);
      
      // Get the wallet instance
      const cdpWallet = await walletProvider.exportWallet();
      
      if (!cdpWallet) {
        throw new Error("Failed to retrieve wallet");
      }
      
      // Import the wallet to get the Coinbase SDK wallet instance
      const wallet = await Wallet.import(cdpWallet);
      
      // Get USDC balance
      console.log(`💰 Fetching USDC balance...`);
      const balance = await wallet.getBalance(Coinbase.assets.Usdc);
      console.log(`💵 USDC Balance: ${Number(balance)} USDC`);
      
      return `Wallet address: ${address}\nUSDC Balance: ${Number(balance)} USDC`;
    } catch (error) {
      console.error(`❌ Error getting USDC balance:`, error);
      throw new Error(`Failed to check USDC balance: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Transfer USDC to another address
   *
   * @description
   * Transfers USDC from the current wallet to a specified address
   *
   * @param walletProvider - The wallet provider instance for blockchain interactions
   * @param args - Transfer arguments including recipient address and amount
   * @returns A promise that resolves to a string with the transfer result
   */
  @CreateAction({
    name: "transfer_usdc",
    description: `
      Transfer USDC from the current wallet to another address.
      
      This action requires:
      - recipientAddress: The Ethereum address to send USDC to
      - amount: The amount of USDC to send (e.g. "0.1")
      
      The action will:
      1. Check if you have sufficient USDC balance
      2. Transfer the specified amount to the recipient
      3. Return the transaction details including a link to view on a block explorer
    `,
    schema: UsdcTransferSchema,
  })
  async transferUsdc(
    walletProvider: CdpWalletProvider,
    args: z.infer<typeof UsdcTransferSchema>,
  ): Promise<string> {
    const { recipientAddress, amount } = args;
    const numericAmount = parseFloat(amount);
    
    try {
      const address = walletProvider.getAddress();
      console.log(`📤 TRANSFER INITIATED`);
      console.log(`💸 Amount: ${numericAmount} USDC`);
      console.log(`🔍 From: ${address}`);
      console.log(`🔍 To: ${recipientAddress}`);
      
      // Get the wallet instance
      const cdpWallet = await walletProvider.exportWallet();
      
      if (!cdpWallet) {
        throw new Error("Failed to retrieve wallet");
      }
      
      // Import the wallet to get the Coinbase SDK wallet instance
      const wallet = await Wallet.import(cdpWallet);
      
      // Check balance
      console.log(`💰 Checking balance for wallet: ${address}...`);
      const balance = await wallet.getBalance(Coinbase.assets.Usdc);
      console.log(`💵 Available balance: ${Number(balance)} USDC`);
      
      if (Number(balance) < numericAmount) {
        return `❌ Insufficient balance. Required: ${numericAmount} USDC, Available: ${Number(balance)} USDC`;
      }
      
      console.log(`🚀 Executing transfer of ${numericAmount} USDC to ${recipientAddress}...`);
      const transfer = await wallet.createTransfer({
        amount: numericAmount,
        assetId: Coinbase.assets.Usdc,
        destination: recipientAddress,
        gasless: true,
      });
      
      console.log(`⏳ Waiting for transfer to complete...`);
      try {
        // Wait for transfer with a longer timeout (120 seconds)
        await transfer.wait({ timeoutSeconds: 120 });
        console.log(`✅ Transfer completed successfully!`);
        
        // Extract transaction link
        const transferData = JSON.parse(JSON.stringify(transfer));
        let transactionLink: string | undefined;
        
        if (transferData.model?.sponsored_send?.transaction_link) {
          transactionLink = transferData.model.sponsored_send.transaction_link;
          console.log(`🔗 Transaction Link: ${transactionLink}`);
        } else {
          // Fallback to constructing Base Sepolia explorer URL
          const txHash = transfer.getId();
          transactionLink = `https://sepolia.basescan.org/tx/${txHash}`;
          console.log(`🔍 Transaction Explorer URL: ${transactionLink}`);
        }
        
        return `✅ Successfully transferred ${numericAmount} USDC to ${recipientAddress}\n\nTransaction Link: ${transactionLink}`;
      } catch (err) {
        if (err instanceof TimeoutError) {
          console.log(`⚠️ Waiting for transfer timed out after 120 seconds, but transaction may still complete`);
          
          // Even if it times out, try to get the transaction link
          try {
            const txHash = transfer.getId();
            const transactionLink = `https://sepolia.basescan.org/tx/${txHash}`;
            return `⚠️ Transfer initiated but waiting for confirmation timed out.\nAmount: ${numericAmount} USDC\nRecipient: ${recipientAddress}\n\nYou can track the transaction here: ${transactionLink}`;
          } catch (hashError) {
            console.error(`❌ Could not get transaction hash:`, hashError);
            return `⚠️ Transfer initiated but waiting for confirmation timed out. The transaction may still complete.`;
          }
        } else {
          console.error(`❌ Error while waiting for transfer to complete:`, err);
          throw new Error(`Transfer failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (error) {
      console.error(`❌ Transfer failed:`, error);
      throw new Error(`Transfer failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Checks if this provider supports the given network.
   *
   * @param network - The network to check support for
   * @returns True if the network is supported
   */
  supportsNetwork(network: Network): boolean {
    // Support EVM networks
    return network.protocolFamily === "evm";
  }
}

/**
 * Factory function to create a new UsdcActionProvider instance.
 *
 * @returns A new UsdcActionProvider instance
 */
export const usdcActionProvider = () => new UsdcActionProvider();
