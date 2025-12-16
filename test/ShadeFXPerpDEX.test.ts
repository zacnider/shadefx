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
    // Deploy mock USDC token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    await usdc.waitForDeployment();
    const usdcAddress = await usdc.getAddress();

    // Deploy Price Oracle
    const PriceOracleFactory = await ethers.getContractFactory("ShadeFXPriceOracle");
    priceOracle = await PriceOracleFactory.deploy(
      ethers.ZeroAddress, // oracleAddress
      false, // useChainlinkOracle
      ethers.ZeroAddress, // pythOracleAddress
      false, // usePythOracle
      owner.address // initialOwner
    );
    await priceOracle.waitForDeployment();
    oracleAddress = await priceOracle.getAddress();

    // Add BTC/USD pair to oracle using addPairWithPyth first
    await priceOracle.connect(owner).addPairWithPyth(
      PAIR_KEY,
      "BTC",
      "USD",
      ethers.ZeroHash, // No Pyth price ID for test
      0, // maxOpenInterest (0 = unlimited)
      5 // maxLeverage
    );
    
    // Then set price using forceUpdatePrice
    await priceOracle.connect(owner).forceUpdatePrice(PAIR_KEY, INITIAL_PRICE);

    // Deploy PerpDEX
    const PerpDEXFactory = await ethers.getContractFactory("ShadeFXPerpDEX");
    perpDEX = await PerpDEXFactory.deploy(oracleAddress, owner.address);
    await perpDEX.waitForDeployment();
    contractAddress = await perpDEX.getAddress();

    // Mint USDC to traders
    const collateralAmount = MIN_COLLATERAL * 10; // 50 USDC
    await usdc.mint(trader1.address, collateralAmount);
    await usdc.mint(trader2.address, collateralAmount);

    // Approve USDC spending
    await usdc.connect(trader1).approve(contractAddress, ethers.MaxUint256);
    await usdc.connect(trader2).approve(contractAddress, ethers.MaxUint256);

    // Add liquidity to pool (required for opening positions)
    const liquidityAmount = MIN_COLLATERAL * 1000; // 5000 USDC
    await usdc.mint(owner.address, liquidityAmount);
    await usdc.connect(owner).approve(contractAddress, ethers.MaxUint256);
    await perpDEX.connect(owner).addLiquidity(liquidityAmount);
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
      const limitPrice = INITIAL_PRICE * 110n / 100n; // 10% above current price

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
      const limitPrice = INITIAL_PRICE * 110n / 100n;

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

      const pairPositions = await perpDEX.getUserPairPositions(PAIR_KEY, trader1.address);
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
      const tx = await perpDEX.connect(owner).pause();
      
      await expect(tx)
        .to.emit(perpDEX, "EmergencyPause");

      expect(await perpDEX.paused()).to.be.true;
    });

    it("Should prevent operations when paused", async function () {
      if (!fhevm.isMock) {
        this.skip();
      }

      await perpDEX.connect(owner).pause();

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
      await perpDEX.connect(owner).pause();
      
      const tx = await perpDEX.connect(owner).unpause();
      
      await expect(tx)
        .to.emit(perpDEX, "Unpaused");

      expect(await perpDEX.paused()).to.be.false;
    });
  });
});

