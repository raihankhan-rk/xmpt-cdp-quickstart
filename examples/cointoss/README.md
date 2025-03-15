# CoinToss Agent

A decentralized coin toss betting agent built with XMTP and Coinbase SDK. This agent operates in group chats and allows users to create and join coin toss games with USDC bets on Base network.

## Features

- XMTP group chat support (responds to @toss mentions)
- Create coin toss games with customizable USDC bet amounts
- Support for multiple players in a single game
- Player identification system for easy player tracking
- Wallet address display for transparency
- Manual game execution by creator
- Transaction hash links for payment verification
- Improved randomness for fair winner selection
- Automatic wallet creation for users and games
- Direct Coinbase SDK integration for wallet management
- Fair and transparent coin toss mechanism
- Real-time messaging through XMTP

## Prerequisites

- Node.js 20+

- Coinbase SDK API key
- OpenAI API Key

## Setup

1. Clone the repository and navigate to the cointoss directory:
```bash
cd examples/cointoss
```

2. Install dependencies:
```bash
yarn install
```

3. Copy the example environment file and fill in your values:
```bash
cp .env.example .env
```

### Required Environment Variables

- `WALLET_KEY`: Your agent's wallet private key for XMTP
- `ENCRYPTION_KEY`: XMTP encryption key
- `OPENAI_API_KEY`: Your OpenAI API key (if needed)
- `KEY`: Encryption key for local wallet storage (or use ENCRYPTION_KEY if not provided)

### Coinbase API Configuration (required)
You must set EITHER the COINBASE_ or CDP_ prefixed versions of these variables:

- `COINBASE_API_KEY_NAME` or `CDP_API_KEY_NAME`: Your Coinbase API key name exactly as shown in the Coinbase developer dashboard

- `COINBASE_API_KEY_PRIVATE_KEY` or `CDP_API_KEY_PRIVATE_KEY`: Your Coinbase API private key in PEM format. Must include:
  ```
  -----BEGIN PRIVATE KEY-----
  MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEA...
  ...many more lines...
  -----END PRIVATE KEY-----
  ```

  To properly format your private key for .env file:
  ```bash
  # If your key is in a file:
  cat your_key.pem | awk '{printf "%s\\n", $0}' | tr -d '\n'
  
  # Then paste the result into your .env after COINBASE_API_KEY_PRIVATE_KEY= or CDP_API_KEY_PRIVATE_KEY=
  ```

### Optional Environment Variables
- `COINBASE_APP_ID`: Your Coinbase app ID for on-ramp features
- `REDIS_URL`: Redis connection URL for storage (defaults to local storage)

4. Build the project:
```bash
yarn build
```

5. Start the agent:
```bash
yarn start
```

For development with more detailed logs:
```bash
yarn dev
```

## Usage

The agent operates in group chats and responds when tagged with `@toss`.

### Available Commands

- `@toss create <amount>` - Create a new coin toss game with specified USDC bet amount
- `@toss join <gameId>` - Join an existing game with the specified ID
- `@toss execute <gameId>` - Execute the coin toss (only for game creator)
- `@toss status <gameId>` - Check the status of a specific game
- `@toss list` - List all active games
- `@toss balance` - Check your wallet balance and address
- `@toss help` - Show available commands

### Example Flow

1. **Invite the bot** to your XMTP group chat

2. **Create a game**:
   ```
   @toss create 0.01
   ```
   This creates a game with a 0.01 USDC bet. The creator is assigned Player ID P1 and automatically pays the bet amount.

3. **Other players join** using the game ID:
   ```
   @toss join 1
   ```
   Each player is assigned a Player ID (P2, P3, etc.) and pays the bet amount.

4. **Check game status** any time:
   ```
   @toss status 1
   ```
   Shows current players, bet amount, prize pool, and other details.

5. **Execute the coin toss** (creator only):
   ```
   @toss execute 1
   ```
   When the creator is ready, they execute the coin toss. A random winner is chosen, and the prize pool is transferred to their wallet.

6. **Results** are displayed showing all players, the winner, and payment confirmation.

## Player Identification

Each player is assigned a simple ID for easy reference:
- **P1**: Always the game creator
- **P2, P3, ...**: Players who join later

Player wallet addresses are displayed in all game information for transparency.

## Prize Pool and Payouts

- All bets are collected in a dedicated game wallet
- Total prize pool = bet amount × number of players
- When the game creator executes the coin toss, a random winner is selected
- The entire prize pool is transferred to the winner's wallet
- Payment status is reported after the game

## Troubleshooting

### Wallet Creation Errors

If you see errors like `Failed to create wallet: APIError` when trying to create a game or check balance:

1. **Coinbase API Keys**: 
   - Check that your `COINBASE_API_KEY_NAME` exactly matches the key name in your Coinbase Developer Dashboard
   - Ensure `COINBASE_API_KEY_PRIVATE_KEY` contains the complete PEM-formatted private key including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines
   - If your private key contains newlines, they must be properly preserved in the `.env` file or replaced with `\n` 

2. **Network Issues**:
   - Verify that you have internet connectivity and can reach Coinbase's API endpoints
   - Check if there are any service outages on Coinbase's status page

3. **Permissions**:
   - Confirm your API key has the necessary permissions in the Coinbase developer portal
   - The API key needs permissions for wallet creation and management

4. **Key Format**:
   - If your private key is in a file, you can use this command to properly format it for .env:
     ```bash
     cat your_key.pem | awk '{printf "%s\\n", $0}' | tr -d '\n'
     ```
   - Then paste the result into your .env file

5. **Try with CDP prefix**:
   - If you're using `COINBASE_API_KEY_NAME` and `COINBASE_API_KEY_PRIVATE_KEY`, try using 
     `CDP_API_KEY_NAME` and `CDP_API_KEY_PRIVATE_KEY` instead for backwards compatibility

### Running the Agent

For best results when starting the agent:

1. Make sure all environment variables are set correctly in your `.env` file
2. Run the agent in development mode to see more detailed logs:
   ```bash
   yarn dev
   ```
3. Watch for any specific error messages in the console that might give more details

If you're still encountering issues, try clearing your local wallet data:
```bash
rm -rf .data/wallets
```

## Architecture

- **Wallet Management**: Direct integration with Coinbase SDK for wallet creation and transfers
- **XMTP Integration**: Group chat support with @toss tag handling
- **Game Logic**: 
  - Dedicated wallet per game and user
  - Support for multiple players
  - Creator-controlled execution
  - Random winner selection
  - Automatic prize distribution
- **Storage Options**: Local storage or Redis for games and wallet data

## Security

- Each user and game gets a dedicated Coinbase wallet
- Encrypted wallet storage using XOR encryption with your provided key
- Direct SDK interaction for secure transfers
- Automatic winnings distribution
- Wallet addresses displayed for transparency
- Transaction hash verification through block explorer links
- Advanced randomness for truly fair winner selection

## Development

1. Run in development mode:
```bash
yarn dev
```

2. Build the project:
```bash
yarn build
```

## License

MIT