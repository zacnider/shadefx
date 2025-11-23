import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  // Constructor parameters
  const ORACLE_ADDRESS = hre.ethers.ZeroAddress; // Legacy oracle - not used
  const USE_CHAINLINK_ORACLE = false; // Legacy flag - not used
  const PYTH_ORACLE_ADDRESS = "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21"; // Ethereum Sepolia Pyth Oracle
  const USE_PYTH_ORACLE = true; // Enable Pyth Network for price feeds
  const INITIAL_OWNER = deployer; // Deployer is the initial owner

  console.log("Deploying ShadeFXPriceOracle contract...");
  console.log("Deployer:", deployer);
  console.log("Legacy Oracle Address:", ORACLE_ADDRESS);
  console.log("Use Chainlink Oracle:", USE_CHAINLINK_ORACLE);
  console.log("Pyth Oracle Address:", PYTH_ORACLE_ADDRESS);
  console.log("Use Pyth Oracle:", USE_PYTH_ORACLE);
  console.log("Initial Owner:", INITIAL_OWNER);

  const deployedOracle = await deploy("ShadeFXPriceOracle", {
    from: deployer,
    args: [ORACLE_ADDRESS, USE_CHAINLINK_ORACLE, PYTH_ORACLE_ADDRESS, USE_PYTH_ORACLE, INITIAL_OWNER],
    log: true,
    waitConfirmations: 1,
  });

  console.log("\n=== Deployment Summary ===");
  console.log("Contract Name: ShadeFXPriceOracle");
  console.log("Contract Address:", deployedOracle.address);
  console.log("Deployer:", deployer);
  console.log("Network:", hre.network.name);
  console.log("Chain ID:", (await hre.ethers.provider.getNetwork()).chainId);
  console.log("Legacy Oracle Address:", ORACLE_ADDRESS);
  console.log("Use Chainlink Oracle:", USE_CHAINLINK_ORACLE);
  console.log("Pyth Oracle Address:", PYTH_ORACLE_ADDRESS);
  console.log("Use Pyth Oracle:", USE_PYTH_ORACLE);
  console.log("\n✅ ShadeFXPriceOracle deployed successfully!");

  console.log("\n=== Deployment Info (for frontend .env) ===");
  console.log(`REACT_APP_PRICE_ORACLE_CONTRACT_ADDRESS=${deployedOracle.address}`);
};

export default func;
func.id = "deploy_price_oracle"; // id required to prevent reexecution
func.tags = ["ShadeFXPriceOracle"];

