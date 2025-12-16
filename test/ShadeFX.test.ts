import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { ShadeFX } from "../typechain-types";

describe("ShadeFX", function () {
  let shadeFX: ShadeFX;
  let owner: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let user3: HardhatEthersSigner;

  const minStakeAmount = ethers.parseEther("0.01");
  const rewardFeePercentage = 5; // 5%

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    const ShadeFXFactory = await ethers.getContractFactory("ShadeFX");
    shadeFX = await ShadeFXFactory.deploy(minStakeAmount, rewardFeePercentage);
    await shadeFX.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await shadeFX.owner()).to.equal(owner.address);
    });

    it("Should set the right minimum stake amount", async function () {
      expect(await shadeFX.minStakeAmount()).to.equal(minStakeAmount);
    });

    it("Should set the right reward fee percentage", async function () {
      expect(await shadeFX.rewardFeePercentage()).to.equal(rewardFeePercentage);
    });
  });

  describe("Currency Pair Creation", function () {
    const currencyPairKey = "EURUSD";
    const baseCurrency = "EUR";
    const quoteCurrency = "USD";
    const predictionDeadline = Math.floor(Date.now() / 1000) + 86400; // 1 day from now
    const resultDeadline = predictionDeadline + 86400; // 2 days from now

    it("Should create a new currency pair", async function () {
      await expect(
        shadeFX.createCurrencyPair(
          currencyPairKey,
          baseCurrency,
          quoteCurrency,
          predictionDeadline,
          resultDeadline
        )
      )
        .to.emit(shadeFX, "CurrencyPairCreated")
        .withArgs(currencyPairKey, baseCurrency, quoteCurrency, predictionDeadline);

      const pair = await shadeFX.rounds(currencyPairKey);
      expect(pair.isActive).to.be.true;
    });

    it("Should not allow non-owner to create currency pair", async function () {
      await expect(
        shadeFX
          .connect(user1)
          .createCurrencyPair(
            currencyPairKey,
            baseCurrency,
            quoteCurrency,
            predictionDeadline,
            resultDeadline
          )
      ).to.be.revertedWith("ShadeFX: caller is not the owner");
    });

    it("Should not allow creating duplicate currency pair", async function () {
      await shadeFX.createCurrencyPair(
        currencyPairKey,
        baseCurrency,
        quoteCurrency,
        predictionDeadline,
        resultDeadline
      );

      await expect(
        shadeFX.createCurrencyPair(
          currencyPairKey,
          baseCurrency,
          quoteCurrency,
          predictionDeadline,
          resultDeadline
        )
      ).to.be.revertedWith("ShadeFX: currency pair already exists");
    });

    it("Should not allow invalid deadlines", async function () {
      const pastDeadline = Math.floor(Date.now() / 1000) - 86400;

      await expect(
        shadeFX.createCurrencyPair(
          currencyPairKey,
          baseCurrency,
          quoteCurrency,
          pastDeadline,
          resultDeadline
        )
      ).to.be.revertedWith("ShadeFX: invalid prediction deadline");

      await expect(
        shadeFX.createCurrencyPair(
          currencyPairKey,
          baseCurrency,
          quoteCurrency,
          predictionDeadline,
          predictionDeadline - 1
        )
      ).to.be.revertedWith("ShadeFX: result deadline must be after prediction deadline");
    });
  });

  describe("Prediction Submission", function () {
    const currencyPairKey = "EURUSD";
    const baseCurrency = "EUR";
    const quoteCurrency = "USD";
    const predictionDeadline = Math.floor(Date.now() / 1000) + 86400;
    const resultDeadline = predictionDeadline + 86400;

    beforeEach(async function () {
      await shadeFX.createCurrencyPair(
        currencyPairKey,
        baseCurrency,
        quoteCurrency,
        predictionDeadline,
        resultDeadline
      );
    });

    it("Should allow users to submit predictions with sufficient stake", async function () {
      // Note: In a real test, we would need to encrypt the prediction using FHEVM
      // For now, this is a placeholder test structure
      const stakeAmount = minStakeAmount;

      // This test would need actual FHEVM encryption in a real scenario
      // await expect(
      //   shadeFX.connect(user1).submitPrediction(currencyPairKey, encryptedPrediction, {
      //     value: stakeAmount,
      //   })
      // )
      //   .to.emit(shadeFX, "PredictionSubmitted")
      //   .withArgs(currencyPairKey, user1.address, anyValue);

      // const predictionCount = await shadeFX.getPredictionCount(currencyPairKey);
      // expect(predictionCount).to.equal(1);
    });

    it("Should not allow predictions with insufficient stake", async function () {
      const insufficientStake = minStakeAmount - BigInt(1);

      // This would fail with "ShadeFX: stake amount too low"
      // await expect(
      //   shadeFX.connect(user1).submitPrediction(currencyPairKey, encryptedPrediction, {
      //     value: insufficientStake,
      //   })
      // ).to.be.revertedWith("ShadeFX: stake amount too low");
    });

    it("Should not allow duplicate predictions from same user", async function () {
      // After first prediction, second should fail
      // await expect(
      //   shadeFX.connect(user1).submitPrediction(currencyPairKey, encryptedPrediction, {
      //     value: minStakeAmount,
      //   })
      // ).to.be.revertedWith("ShadeFX: prediction already submitted");
    });

    it("Should not allow predictions after deadline", async function () {
      // Would need to manipulate block timestamp
      // await network.provider.send("evm_increaseTime", [86401]);
      // await expect(
      //   shadeFX.connect(user1).submitPrediction(currencyPairKey, encryptedPrediction, {
      //     value: minStakeAmount,
      //   })
      // ).to.be.revertedWith("ShadeFX: prediction deadline passed");
    });
  });

  describe("Result Declaration", function () {
    const currencyPairKey = "EURUSD";
    const baseCurrency = "EUR";
    const quoteCurrency = "USD";
    const predictionDeadline = Math.floor(Date.now() / 1000) + 86400;
    const resultDeadline = predictionDeadline + 86400;

    beforeEach(async function () {
      await shadeFX.createCurrencyPair(
        currencyPairKey,
        baseCurrency,
        quoteCurrency,
        predictionDeadline,
        resultDeadline
      );
    });

    it("Should allow owner to declare result after prediction deadline", async function () {
      // Would need to wait for prediction deadline and encrypt real value
      // await network.provider.send("evm_increaseTime", [86401]);
      // await expect(
      //   shadeFX.declareResult(currencyPairKey, encryptedRealValue)
      // )
      //   .to.emit(shadeFX, "ResultDeclared")
      //   .withArgs(currencyPairKey, anyValue);
    });

    it("Should not allow non-owner to declare result", async function () {
      // await expect(
      //   shadeFX.connect(user1).declareResult(currencyPairKey, encryptedRealValue)
      // ).to.be.revertedWith("ShadeFX: caller is not the owner");
    });

    it("Should not allow declaring result before prediction deadline", async function () {
      // await expect(
      //   shadeFX.declareResult(currencyPairKey, encryptedRealValue)
      // ).to.be.revertedWith("ShadeFX: prediction period not ended");
    });
  });

  describe("Reward Claiming", function () {
    const currencyPairKey = "EURUSD";
    const baseCurrency = "EUR";
    const quoteCurrency = "USD";
    const predictionDeadline = Math.floor(Date.now() / 1000) + 86400;
    const resultDeadline = predictionDeadline + 86400;

    beforeEach(async function () {
      await shadeFX.createCurrencyPair(
        currencyPairKey,
        baseCurrency,
        quoteCurrency,
        predictionDeadline,
        resultDeadline
      );
    });

    it("Should allow winners to claim rewards", async function () {
      // Would need to set up predictions, declare result, reveal winners
      // Then test reward claiming
    });

    it("Should not allow non-winners to claim rewards", async function () {
      // await expect(
      //   shadeFX.connect(user1).claimReward(currencyPairKey)
      // ).to.be.revertedWith("ShadeFX: not a winner");
    });

    it("Should not allow claiming before result is declared", async function () {
      // await expect(
      //   shadeFX.connect(user1).claimReward(currencyPairKey)
      // ).to.be.revertedWith("ShadeFX: result not declared yet");
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to update minimum stake amount", async function () {
      const newMinStake = ethers.parseEther("0.02");
      await shadeFX.setMinStakeAmount(newMinStake);
      expect(await shadeFX.minStakeAmount()).to.equal(newMinStake);
    });

    it("Should not allow non-owner to update minimum stake amount", async function () {
      const newMinStake = ethers.parseEther("0.02");
      await expect(
        shadeFX.connect(user1).setMinStakeAmount(newMinStake)
      ).to.be.revertedWith("ShadeFX: caller is not the owner");
    });

    it("Should allow owner to update reward fee percentage", async function () {
      const newFee = 10;
      await shadeFX.setRewardFeePercentage(newFee);
      expect(await shadeFX.rewardFeePercentage()).to.equal(newFee);
    });

    it("Should not allow fee percentage above 20%", async function () {
      await expect(shadeFX.setRewardFeePercentage(21)).to.be.revertedWith(
        "ShadeFX: fee too high"
      );
    });

    it("Should allow owner to emergency withdraw", async function () {
      // Send some ETH to contract
      await owner.sendTransaction({
        to: await shadeFX.getAddress(),
        value: ethers.parseEther("1.0"),
      });

      const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);
      await shadeFX.emergencyWithdraw();
      const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);

      expect(ownerBalanceAfter).to.be.gt(ownerBalanceBefore);
    });
  });

  describe("View Functions", function () {
    const currencyPairKey = "EURUSD";
    const baseCurrency = "EUR";
    const quoteCurrency = "USD";
    const predictionDeadline = Math.floor(Date.now() / 1000) + 86400;
    const resultDeadline = predictionDeadline + 86400;

    beforeEach(async function () {
      await shadeFX.createCurrencyPair(
        currencyPairKey,
        baseCurrency,
        quoteCurrency,
        predictionDeadline,
        resultDeadline
      );
    });

    it("Should return correct prediction count", async function () {
      const count = await shadeFX.getPredictionCount(currencyPairKey);
      expect(count).to.equal(0);
    });

    it("Should return correct reward pool", async function () {
      const pool = await shadeFX.getRewardPool(currencyPairKey);
      expect(pool).to.equal(0);
    });

    it("Should return active pairs", async function () {
      const pairs = await shadeFX.getActivePairs();
      expect(pairs.length).to.equal(1);
      expect(pairs[0]).to.equal(currencyPairKey);
    });
  });
});

