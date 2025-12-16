# ShadeFX Indexer

Envio indexer for ShadeFX confidential predictions dApp on Sepolia Testnet.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Generate code:
```bash
npm run codegen
```

3. Start indexer in development mode:
```bash
npm run dev
```

4. Start indexer in production mode:
```bash
npm run start
```

## Configuration

Edit `config.yaml` to:
- Update contract address if redeployed
- Set `start_block` to the deployment block number
- Configure RPC endpoints

## Schema

The indexer tracks:
- **Rounds**: Each prediction round for a currency pair
- **Predictions**: User predictions with stake amounts
- **UserStats**: User statistics, win/loss, points
- **PointAwards**: Individual point awards with reasons
- **Leaderboards**: Weekly and monthly leaderboards

## Points System

Points are awarded for:
- **Participation**: 5 points per prediction
- **First Prediction**: +10 points
- **Early Bird**: +20 points (first 10% of predictions)
- **Winning**: 100 base points
- **Win Streak**: 50-500 bonus points
- **High Stake**: 25-300 bonus points based on stake amount

## API

The indexer provides a GraphQL API. Query examples:

```graphql
# Get user stats
query GetUserStats($address: Bytes!) {
  userStats(id: $address) {
    totalPoints
    winRate
    totalWon
    totalLost
  }
}

# Get leaderboard
query GetLeaderboard {
  userStats(
    orderBy: totalPoints
    orderDirection: desc
    first: 100
  ) {
    id
    address
    totalPoints
    winRate
  }
}
```

