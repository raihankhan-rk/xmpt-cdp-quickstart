# CoinToss Agent

A decentralized coin toss betting agent built with XMTP and CDP AgentKit. Users can create and join coin toss games with USDC bets on Base network.

## Features

- Create coin toss games with USDC bets
- Join existing games
- Automatic wallet creation for users and games
- Fair and transparent coin toss mechanism
- Support for both local and Redis storage
- Real-time messaging through XMTP

## Prerequisites

- Node.js 18+
- Yarn or npm
- Redis (optional)
- Base network USDC tokens for betting

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
cp src/.env.example .env
```

Required environment variables:
- `WALLET_KEY`: Your agent's wallet private key
- `ENCRYPTION_KEY`: XMTP encryption key
- `CDP_API_KEY_NAME`: Your CDP API key name
- `CDP_API_KEY_PRIVATE_KEY`: Your CDP API private key
- `NETWORK_ID`: Network ID (default: base-mainnet)
- `OPENAI_API_KEY`: Your OpenAI API key
- `REDIS_URL` (optional): Redis connection URL

4. Build the project:
```bash
yarn build
```

5. Start the agent:
```bash
yarn start
```

## Usage

The agent responds to the following commands in XMTP chat:

- `/create <amount>` - Create a new coin toss game with specified USDC bet amount
- `/join <gameId>` - Join an existing game with the specified ID
- `/list` - List all active games
- `/balance` - Check your wallet balance
- `/help` - Show available commands

### Example Flow

1. First user creates a game:
```
/create 10
```

2. Second user joins the game using the game ID:
```
/join abc123
```

3. The game automatically executes the coin toss and distributes winnings.

## Storage Options

The agent supports two storage backends:

1. Local Storage (default)
   - Game data stored in `data/games`
   - Wallet data stored in `wallet_data`

2. Redis Storage
   - Enable by setting `REDIS_URL` in .env
   - Recommended for production use

## Security

- Each game creates a new CDP wallet for holding funds
- User wallets are encrypted and stored securely
- All transactions use gasless USDC on Base
- Smart contract interactions handled by CDP AgentKit

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