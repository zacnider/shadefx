# ShadeFX Testing Guide

## Overview

This guide explains how to run tests for ShadeFX PerpDEX, including FHEVM integration tests.

## Prerequisites

Before running tests, ensure you have:

1. **Dependencies installed**:
   ```bash
   npm install
   ```

2. **Environment setup**:
   - No `.env` file required for local testing
   - Tests use Hardhat's built-in FHEVM mock environment

## Running Tests

### Quick Start

Run all tests:
```bash
npm test
```

Run tests with coverage:
```bash
npm run coverage
```

### Test Structure

The test suite includes:

1. **FHEVM Integration Tests** (`test/ShadeFXPerpDEX.test.ts`)
   - Deployment tests
   - Encrypted market order tests (Long/Short positions)
   - Encrypted limit order tests
   - Position management tests
   - Admin function tests
   - Pause functionality tests

## Test Details

### FHEVM Integration Tests

The main test file `test/ShadeFXPerpDEX.test.ts` tests FHEVM-encrypted operations:

#### 1. Deployment Tests
```bash
# Tests contract deployment
npm test -- --grep "Deployment"
```

**What it tests:**
- Price Oracle deployment
- PerpDEX deployment
- Contract initialization
- Owner assignment

#### 2. Encrypted Market Order Tests
```bash
# Tests encrypted position opening
npm test -- --grep "FHEVM Encryption - Market Orders"
```

**What it tests:**
- Long position with encrypted direction
- Short position with encrypted direction
- Encrypted leverage (1-5x)
- Position creation with FHEVM encryption

**Example test flow:**
1. User encrypts direction (Long/Short) using FHEVM
2. User encrypts leverage using FHEVM
3. Encrypted values are sent to contract
4. Contract processes encrypted values
5. Position is created successfully

#### 3. Encrypted Limit Order Tests
```bash
# Tests encrypted limit orders
npm test -- --grep "FHEVM Encryption - Limit Orders"
```

**What it tests:**
- Limit order creation with encrypted direction
- Order execution when price condition is met
- Order cancellation
- Order expiry

#### 4. Position Management Tests
```bash
# Tests position operations
npm test -- --grep "Position Management"
```

**What it tests:**
- Position closing
- PnL calculation
- Liquidation
- Position queries

#### 5. Admin Function Tests
```bash
# Tests admin operations
npm test -- --grep "Admin Functions"
```

**What it tests:**
- Fee setting
- Leverage limits
- Pair management
- Pause/unpause

## Understanding FHEVM Tests

### FHEVM Mock Environment

Tests use Hardhat's FHEVM mock environment, which simulates FHEVM operations without requiring a real FHEVM network.

**Key points:**
- Tests automatically use mock FHEVM if available
- No external FHEVM service required
- Tests run faster than real FHEVM tests

### Encrypted Input Creation

In tests, encrypted inputs are created like this:

```typescript
// Create encrypted input for direction and leverage
const input = fhevm.createEncryptedInput(contractAddress, trader1.address);
input.addBool(true);  // Long position
input.add32(2);       // 2x leverage
const enc = await input.encrypt();

// Extract encrypted values
const encryptedDirection = enc.handles[0];
const encryptedLeverage = enc.handles[1];
const inputProof = enc.inputProof;
```

### Test Execution Flow

1. **Setup**: Deploy contracts and prepare test environment
2. **Encryption**: Create encrypted inputs using FHEVM mock
3. **Execution**: Call contract functions with encrypted values
4. **Verification**: Check that operations completed successfully

## Running Specific Tests

### Run a single test file:
```bash
npx hardhat test test/ShadeFXPerpDEX.test.ts
```

### Run tests matching a pattern:
```bash
npm test -- --grep "Market Orders"
```

### Run tests with verbose output:
```bash
npm test -- --verbose
```

## Test Coverage

Generate coverage report:
```bash
npm run coverage
```

This will:
1. Run all tests with coverage tracking
2. Generate coverage report in `coverage/` directory
3. Open HTML report in browser (if configured)

**Coverage report location:**
- HTML: `coverage/lcov-report/index.html`
- JSON: `coverage/coverage.json`

## Troubleshooting

### Tests Fail with "FHEVM not initialized"

**Problem**: Tests fail because FHEVM is not properly initialized.

**Solution**:
1. Ensure `@fhevm/hardhat-plugin` is installed
2. Check `hardhat.config.ts` includes the plugin
3. Verify tests are using mock FHEVM environment

### Tests Timeout

**Problem**: Tests take too long or timeout.

**Solution**:
1. Increase timeout in `hardhat.config.ts`:
   ```typescript
   mocha: {
     timeout: 60000, // 60 seconds
   }
   ```

### "Contract not deployed" Error

**Problem**: Tests fail because contracts aren't deployed.

**Solution**:
1. Ensure `beforeEach` hook runs successfully
2. Check contract deployment in test setup
3. Verify all required contracts are deployed

## Test Best Practices

1. **Isolation**: Each test should be independent
2. **Cleanup**: Reset state between tests
3. **Assertions**: Use clear, descriptive assertions
4. **Coverage**: Aim for high test coverage (>80%)

## Continuous Integration

Tests can be run in CI/CD pipelines:

```yaml
# Example GitHub Actions
- name: Run tests
  run: npm test

- name: Generate coverage
  run: npm run coverage
```

## Next Steps

After running tests successfully:

1. **Review Coverage**: Check which parts need more tests
2. **Fix Issues**: Address any failing tests
3. **Deploy**: Proceed with deployment (see [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md))

## Additional Resources

- [Hardhat Testing Guide](https://hardhat.org/docs/guides/test-contracts)
- [FHEVM Testing Documentation](https://docs.zama.ai/fhevm)
- [Chai Assertions](https://www.chaijs.com/api/bdd/)

