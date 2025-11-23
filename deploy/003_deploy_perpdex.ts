import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;

  // Get deployed price oracle contract
  const priceOracleDeployment = await get("ShadeFXPriceOracle");
  if (!priceOracleDeployment) {
    throw new Error("ShadeFXPriceOracle must be deployed first. Run: npx hardhat deploy --tags ShadeFXPriceOracle");
  }

  const PRICE_ORACLE_ADDRESS = priceOracleDeployment.address;
  const INITIAL_OWNER = deployer; // Deployer is the initial owner

  console.log("Deploying ShadeFXPerpDEX contract...");
  console.log("Deployer:", deployer);
  console.log("Price Oracle Address:", PRICE_ORACLE_ADDRESS);
  console.log("Initial Owner:", INITIAL_OWNER);

  const deployedPerpDEX = await deploy("ShadeFXPerpDEX", {
    from: deployer,
    args: [PRICE_ORACLE_ADDRESS, INITIAL_OWNER],
    log: true,
    waitConfirmations: 1,
  });

  console.log("\n=== Deployment Summary ===");
  console.log("Contract Name: ShadeFXPerpDEX");
  console.log("Contract Address:", deployedPerpDEX.address);
  console.log("Deployer:", deployer);
  console.log("Network:", hre.network.name);
  console.log("Chain ID:", (await hre.ethers.provider.getNetwork()).chainId);
  console.log("Price Oracle Address:", PRICE_ORACLE_ADDRESS);
  console.log("\n✅ ShadeFXPerpDEX deployed successfully!");

  console.log("\n=== Deployment Info (for frontend .env) ===");
  console.log(`REACT_APP_PERPDEX_CONTRACT_ADDRESS=${deployedPerpDEX.address}`);
  console.log(`REACT_APP_PRICE_ORACLE_CONTRACT_ADDRESS=${PRICE_ORACLE_ADDRESS}`);
};

export default func;
func.id = "deploy_perpdex"; // id required to prevent reexecution
func.tags = ["ShadeFXPerpDEX"];
func.dependencies = ["ShadeFXPriceOracle"]; // Ensure oracle is deployed first

