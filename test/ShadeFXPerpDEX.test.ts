import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { FhevmType, HardhatFhevmRuntimeEnvironment } from "@fhevm/hardhat-plugin";
import { ShadeFXPerpDEX } from "../typechain-types";
import { ShadeFXPriceOracle } from "../typechain-types";
import { IERC20 } from "../typechain-types";

describe("ShadeFXPerpDEX - FHEVM Integration Tests", function () {
  let perpDEX: ShadeFXPerpDEX;
  let priceOracle: ShadeFXPriceOracle;
  let usdc: IERC20;
  let owner: HardhatEthersSigner;
  let trader1: HardhatEthersSigner;
  let trader2: HardhatEthersSigner;
  let fhevm: HardhatFhevmRuntimeEnvironment;
  let contractAddress: string;
  let oracleAddress: string;

  const MIN_COLLATERAL = 5 * 1e6; // 5 USDC (6 decimals)
  const PAIR_KEY = "BTCUSD";
  const INITIAL_PRICE = 50000 * 1e8; // $50,000 scaled by PRICE_PRECISION (1e8)

  before(async function () {
    [owner, trader1, trader2] = await ethers.getSigners();
    fhevm = hre.fhevm;
    
    // Check if running on FHEVM mock environment
    if (!fhevm.isMock) {
      console.log("⚠️  Warning: Tests require FHEVM mock environment. Some tests may be skipped.");
    }
  });

  beforeEach(async function () {
    // Contract uses hardcoded USDC address: 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
    // We need to deploy mock USDC to this exact address using hardhat_setCode
    const SEPOLIA_USDC_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
    
    // Deploy mock USDC to get bytecode
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const mockUSDC = await MockERC20.deploy("USD Coin", "USDC", 6);
    await mockUSDC.waitForDeployment();
    
    // Get the bytecode of the deployed mock USDC
    const mockUSDCBytecode = await ethers.provider.getCode(await mockUSDC.getAddress());
    
    // Deploy mock USDC to the hardcoded address using hardhat_setCode
    await ethers.provider.send("hardhat_setCode", [SEPOLIA_USDC_ADDRESS, mockUSDCBytecode]);
    
    // Now get the contract instance at the hardcoded address
    usdc = await ethers.getContractAt("MockERC20", SEPOLIA_USDC_ADDRESS);
    
    // Since constructor won't run with hardhat_setCode, we need to set storage manually
    // ERC20 storage layout (OpenZeppelin):
    // - _balances: mapping slot 0
    // - _allowances: mapping slot 1
    // - _totalSupply: slot 2
    // - _name: slot 3 (string, first 32 bytes = length, then data)
    // - _symbol: slot 4 (string, first 32 bytes = length, then data)
    // - _decimals: slot 5 (MockERC20 stores decimals here)
    
    // Set decimals to 6 (MockERC20 uses slot 5 for _decimals)
    // Note: This is a simplified approach - actual storage layout may vary
    // We'll try to set it, but if it doesn't work, we'll use a different approach
    
    // Actually, let's try a simpler approach: use hardhat_impersonateAccount
    // But first, let's try if mint() works without setting storage
    // If it doesn't, we'll need to set storage manually

    // Deploy Price Oracle (no Pyth Oracle needed for tests)
    const PriceOracleFactory = await ethers.getContractFactory("ShadeFXPriceOracle");
    priceOracle = await PriceOracleFactory.deploy(
      ethers.ZeroAddress, // oracleAddress
      false, // useChainlinkOracle
      ethers.ZeroAddress, // pythOracleAddress (not needed for tests)
      false, // usePythOracle (not needed for tests)
      owner.address // initialOwner
    );
    await priceOracle.waitForDeployment();
    oracleAddress = await priceOracle.getAddress();

    // Add BTC/USD pair using addPairForTesting (no Pyth Oracle required)
    await priceOracle.connect(owner).addPairForTesting(
      PAIR_KEY,
      "BTC",
      "USD",
      INITIAL_PRICE, // Initial price
      0, // maxOpenInterest (0 = unlimited)
      5 // maxLeverage
    );

    // Deploy PerpDEX
    const PerpDEXFactory = await ethers.getContractFactory("ShadeFXPerpDEX");
    perpDEX = await PerpDEXFactory.deploy(oracleAddress, owner.address);
    await perpDEX.waitForDeployment();
    contractAddress = await perpDEX.getAddress();

    // Mint USDC to traders
    // Note: Since constructor didn't run, we need to ensure mint() works
    // If mint() fails, the contract storage wasn't initialized properly
    const collateralAmount = MIN_COLLATERAL * 10; // 50 USDC
    try {
      await usdc.mint(trader1.address, collateralAmount);
      await usdc.mint(trader2.address, collateralAmount);
      console.log("✅ USDC mint successful");
    } catch (error: any) {
      console.error("❌ USDC mint failed:", error.message);
      // If mint fails, we can't proceed with tests that need USDC
      throw new Error("Mock USDC initialization failed. Cannot run tests.");
    }

    // Approve USDC spending
    await usdc.connect(trader1).approve(contractAddress, ethers.MaxUint256);
    await usdc.connect(trader2).approve(contractAddress, ethers.MaxUint256);

    // Add liquidity to pool (required for opening positions)
    // Now that mock USDC is at the hardcoded address, addLiquidity should work
    const liquidityAmount = MIN_COLLATERAL * 1000; // 5000 USDC
    try {
      await usdc.mint(owner.address, liquidityAmount);
      await usdc.connect(owner).approve(contractAddress, ethers.MaxUint256);
      await perpDEX.connect(owner).addLiquidity(liquidityAmount);
      console.log("✅ Liquidity added successfully");
    } catch (error: any) {
      console.error("❌ addLiquidity failed:", error.message);
      // If addLiquidity fails, tests that need liquidity will fail
      // But we can still run tests that don't need liquidity
    }
  });

  describe("Deployment", function () {
    it("Should deploy with correct initial values", async function () {
      expect(await perpDEX.getAddress()).to.be.properAddress;
      expect(await perpDEX.owner()).to.equal(owner.address);
      expect(await perpDEX.maxLeverage()).to.equal(5);
    });

    it("Should have correct minimum collateral", async function () {
      // MIN_COLLATERAL is a constant, we can check it via a transaction that requires it
      const collateralTooLow = MIN_COLLATERAL - 1;
      
      // Create encrypted input for direction (Long = true)
      const input = fhevm.createEncryptedInput(contractAddress, trader1.address);
      input.addBool(true); // Long position
      input.add32(2); // Leverage 2x
      const enc = await input.encrypt();

      await expect(
        perpDEX.connect(trader1).createMarketOrder(
          PAIR_KEY,
          enc.handles[0], // encryptedDirection
          enc.handles[1], // encryptedLeverage
          enc.inputProof,
          enc.inputProof,
          2, // leverage (plain)
          collateralTooLow
        )
      ).to.be.revertedWith("ShadeFX: collateral below minimum");
    });
  });

  describe("FHEVM Encryption - Market Orders", function () {
    it("Should encrypt and open a Long position", async function () {
      if (!fhevm.isMock) {
        this.skip();
      }

      const collateralAmount = MIN_COLLATERAL * 2; // 10 USDC
      const leverage = 2; // 2x leverage

      // Create encrypted input for direction (Long = true) and leverage
      const input = fhevm.createEncryptedInput(contractAddress, trader1.address);
      input.addBool(true); // Long position
      input.add32(leverage); // Leverage 2x
      const enc = await input.encrypt();

      const encryptedDirection = enc.handles[0];
      const encryptedLeverage = enc.handles[1];
      const inputProof = enc.inputProof;

      // Open position
      const tx = await perpDEX.connect(trader1).createMarketOrder(
        PAIR_KEY,
        encryptedDirection,
        encryptedLeverage,
        inputProof,
        inputProof,
        leverage,
        collateralAmount
      );

      await expect(tx)
        .to.emit(perpDEX, "PositionOpened")
        .withArgs(
          (positionId: bigint) => positionId > 0n,
          trader1.address,
          PAIR_KEY,
          (price: bigint) => price > 0n,
          (size: bigint) => size === BigInt(collateralAmount * leverage),
          (collateral: bigint) => collateral === BigInt(collateralAmount),
          (lev: bigint) => lev === BigInt(leverage),
          (fee: bigint) => fee >= 0n
        );

      // Check position was created
      const positionId = 1;
      const position = await perpDEX.positions(positionId);
      expect(position.trader).to.equal(trader1.address);
      expect(position.pairKey).to.equal(PAIR_KEY);
      expect(position.collateral).to.equal(collateralAmount);
      expect(position.leverage).to.equal(leverage);
      expect(position.isOpen).to.be.true;
    });

    it("Should encrypt and open a Short position", async function () {
      if (!fhevm.isMock) {
        this.skip();
      }

      const collateralAmount = MIN_COLLATERAL * 2; // 10 USDC
      const leverage = 3; // 3x leverage

      // Create encrypted input for direction (Short = false) and leverage
      const input = fhevm.createEncryptedInput(contractAddress, trader2.address);
      input.addBool(false); // Short position
      input.add32(leverage); // Leverage 3x
      const enc = await input.encrypt();

      const encryptedDirection = enc.handles[0];
      const encryptedLeverage = enc.handles[1];
      const inputProof = enc.inputProof;

      // Open position
      const tx = await perpDEX.connect(trader2).createMarketOrder(
        PAIR_KEY,
        encryptedDirection,
        encryptedLeverage,
        inputProof,
        inputProof,
        leverage,
        collateralAmount
      );

      await expect(tx)
        .to.emit(perpDEX, "PositionOpened")
        .withArgs(
          (positionId: bigint) => positionId > 0n,
          trader2.address,
          PAIR_KEY,
          (price: bigint) => price > 0n,
          (size: bigint) => size === BigInt(collateralAmount * leverage),
          (collateral: bigint) => collateral === BigInt(collateralAmount),
          (lev: bigint) => lev === BigInt(leverage),
          (fee: bigint) => fee >= 0n
        );

      // Check position was created
      const positionId = 1;
      const position = await perpDEX.positions(positionId);
      expect(position.trader).to.equal(trader2.address);
      expect(position.isOpen).to.be.true;
    });

    it("Should reject position with insufficient collateral", async function () {
      if (!fhevm.isMock) {
        this.skip();
      }

      const collateralAmount = MIN_COLLATERAL - 1; // Below minimum
      const leverage = 2;

      const input = fhevm.createEncryptedInput(contractAddress, trader1.address);
      input.addBool(true);
      input.add32(leverage);
      const enc = await input.encrypt();

      await expect(
        perpDEX.connect(trader1).createMarketOrder(
          PAIR_KEY,
          enc.handles[0],
          enc.handles[1],
          enc.inputProof,
          enc.inputProof,
          leverage,
          collateralAmount
        )
      ).to.be.revertedWith("ShadeFX: collateral below minimum");
    });

    it("Should reject position with invalid leverage", async function () {
      if (!fhevm.isMock) {
        this.skip();
      }

      const collateralAmount = MIN_COLLATERAL * 2;
      const leverage = 10; // Exceeds maxLeverage (5)

      const input = fhevm.createEncryptedInput(contractAddress, trader1.address);
      input.addBool(true);
      input.add32(leverage);
      const enc = await input.encrypt();

      await expect(
        perpDEX.connect(trader1).createMarketOrder(
          PAIR_KEY,
          enc.handles[0],
          enc.handles[1],
          enc.inputProof,
          enc.inputProof,
          leverage,
          collateralAmount
        )
      ).to.be.revertedWith("ShadeFX: invalid leverage");
    });
  });

  describe("FHEVM Encryption - Limit Orders", function () {
    it("Should create a limit order with encrypted direction", async function () {
      if (!fhevm.isMock) {
        this.skip();
      }

      const collateralAmount = MIN_COLLATERAL * 2;
      const leverage = 2;
      const limitPrice = (BigInt(INITIAL_PRICE) * 110n) / 100n; // 10% above current price

      // Create encrypted input for direction
      const input = fhevm.createEncryptedInput(contractAddress, trader1.address);
      input.addBool(true); // Long position
      const enc = await input.encrypt();

      const encryptedDirection = enc.handles[0];
      const inputProof = enc.inputProof;

      // Create limit order
      const tx = await perpDEX.connect(trader1).createLimitOrder(
        PAIR_KEY,
        encryptedDirection,
        inputProof,
        limitPrice,
        leverage,
        collateralAmount,
        0 // No expiry
      );

      await expect(tx)
        .to.emit(perpDEX, "OrderCreated")
        .withArgs(
          (orderId: bigint) => orderId > 0n,
          trader1.address,
          PAIR_KEY,
          1, // OrderType.LIMIT
          limitPrice,
          (collateral: bigint) => collateral === BigInt(collateralAmount),
          (lev: bigint) => lev === BigInt(leverage)
        );

      // Check order was created
      const orderId = 1;
      const order = await perpDEX.orders(orderId);
      expect(order.trader).to.equal(trader1.address);
      expect(order.pairKey).to.equal(PAIR_KEY);
      expect(order.orderType).to.equal(1); // LIMIT
      expect(order.status).to.equal(0); // PENDING
      expect(order.limitPrice).to.equal(limitPrice);
    });

    it("Should cancel a limit order", async function () {
      if (!fhevm.isMock) {
        this.skip();
      }

      const collateralAmount = MIN_COLLATERAL * 2;
      const leverage = 2;
      const limitPrice = (BigInt(INITIAL_PRICE) * 110n) / 100n;

      const input = fhevm.createEncryptedInput(contractAddress, trader1.address);
      input.addBool(true);
      const enc = await input.encrypt();

      // Create limit order
      await perpDEX.connect(trader1).createLimitOrder(
        PAIR_KEY,
        enc.handles[0],
        enc.inputProof,
        limitPrice,
        leverage,
        collateralAmount,
        0
      );

      const orderId = 1;

      // Cancel order
      const tx = await perpDEX.connect(trader1).cancelOrder(orderId);

      await expect(tx)
        .to.emit(perpDEX, "OrderCancelled")
        .withArgs(orderId, trader1.address, PAIR_KEY);

      const order = await perpDEX.orders(orderId);
      expect(order.status).to.equal(2); // CANCELLED
    });
  });

  describe("Position Management", function () {
    beforeEach(async function () {
      if (!fhevm.isMock) {
        this.skip();
      }

      // Open a position for testing
      const collateralAmount = MIN_COLLATERAL * 2;
      const leverage = 2;

      const input = fhevm.createEncryptedInput(contractAddress, trader1.address);
      input.addBool(true); // Long
      input.add32(leverage);
      const enc = await input.encrypt();

      await perpDEX.connect(trader1).createMarketOrder(
        PAIR_KEY,
        enc.handles[0],
        enc.handles[1],
        enc.inputProof,
        enc.inputProof,
        leverage,
        collateralAmount
      );
    });

    it("Should return user positions", async function () {
      if (!fhevm.isMock) {
        this.skip();
      }

      const userPositions = await perpDEX.getUserPositions(trader1.address);
      expect(userPositions.length).to.equal(1);
      expect(userPositions[0]).to.equal(1);
    });

    it("Should return pair-specific positions", async function () {
      if (!fhevm.isMock) {
        this.skip();
      }

      // Contract signature: getUserPairPositions(address user, string memory pairKey)
      // Note: Parameter order is (user, pairKey) not (pairKey, user)
      const trader1Address = await trader1.getAddress();
      const pairPositions = await perpDEX.getUserPairPositions(trader1Address, PAIR_KEY);
      expect(pairPositions.length).to.equal(1);
      expect(pairPositions[0]).to.equal(1);
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to set opening fee", async function () {
      const newFee = 25; // 0.025%
      const tx = await perpDEX.connect(owner).setOpeningFeeBP(newFee);
      
      await expect(tx)
        .to.emit(perpDEX, "OpeningFeeUpdated")
        .withArgs(newFee);

      expect(await perpDEX.openingFeeBP()).to.equal(newFee);
    });

    it("Should allow owner to set closing fee", async function () {
      const newFee = 50; // 0.05%
      const tx = await perpDEX.connect(owner).setClosingFeeBP(newFee);
      
      await expect(tx)
        .to.emit(perpDEX, "ClosingFeeUpdated")
        .withArgs(newFee);

      expect(await perpDEX.closingFeeBP()).to.equal(newFee);
    });

    it("Should allow owner to set max leverage", async function () {
      const newMaxLeverage = 10;
      const tx = await perpDEX.connect(owner).setMaxLeverage(newMaxLeverage);
      
      await expect(tx)
        .to.emit(perpDEX, "MaxLeverageUpdated")
        .withArgs(newMaxLeverage);

      expect(await perpDEX.maxLeverage()).to.equal(newMaxLeverage);
    });

    it("Should reject non-owner from setting fees", async function () {
      await expect(
        perpDEX.connect(trader1).setOpeningFeeBP(25)
      ).to.be.revertedWithCustomError(perpDEX, "OwnableUnauthorizedAccount");
    });
  });

  describe("Pause Functionality", function () {
    it("Should allow owner to pause contract", async function () {
      const tx = await perpDEX.connect(owner).emergencyPause();
      
      await expect(tx)
        .to.emit(perpDEX, "EmergencyPause");

      expect(await perpDEX.paused()).to.be.true;
    });

    it("Should prevent operations when paused", async function () {
      if (!fhevm.isMock) {
        this.skip();
      }

      await perpDEX.connect(owner).emergencyPause();

      const collateralAmount = MIN_COLLATERAL * 2;
      const leverage = 2;

      const input = fhevm.createEncryptedInput(contractAddress, trader1.address);
      input.addBool(true);
      input.add32(leverage);
      const enc = await input.encrypt();

      await expect(
        perpDEX.connect(trader1).createMarketOrder(
          PAIR_KEY,
          enc.handles[0],
          enc.handles[1],
          enc.inputProof,
          enc.inputProof,
          leverage,
          collateralAmount
        )
      ).to.be.revertedWithCustomError(perpDEX, "EnforcedPause");
    });

    it("Should allow owner to unpause contract", async function () {
      await perpDEX.connect(owner).emergencyPause();
      
      const tx = await perpDEX.connect(owner).emergencyUnpause();
      
      await expect(tx)
        .to.emit(perpDEX, "EmergencyUnpause");

      expect(await perpDEX.paused()).to.be.false;
    });
  });
});

