# ShadeFX Deployment Guide

## 🚀 Deploy Etme Rehberi

Bu rehber, ShadeFX kontratlarını deploy etmek için gerekli tüm adımları içerir.

## 📋 Ön Hazırlık

### 1. Bağımlılıkları Kurun

```bash
npm install
```

### 2. Environment Variables Ayarlayın

`.env` dosyası oluşturun:

```env
# Private key for deployment (without 0x prefix)
PRIVATE_KEY=your_private_key_here

# RPC URLs
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/your_infura_key
FHENIX_RPC_URL=https://api.helium.fhenix.zone

# Chain IDs
FHENIX_CHAIN_ID=8008135

# Etherscan API Key (for contract verification)
ETHERSCAN_API_KEY=your_etherscan_api_key

# Optional: Mnemonic for hardhat network
MNEMONIC=test test test test test test test test test test test junk
```

### 3. Kontratları Compile Edin

```bash
npm run compile
```

Bu komut:
- Kontratları compile eder
- TypeChain type'larını oluşturur
- Artifacts'ları oluşturur

## 🧪 Test Edin

### Localhost'ta Test

```bash
# Terminal 1: Hardhat node başlat
npm run chain

# Terminal 2: Testleri çalıştır
npm test
```

### Sepolia'da Test

```bash
npm run test:sepolia
```

## 📦 Deploy İşlemleri

### 1. Localhost'a Deploy

```bash
# Terminal 1: Hardhat node başlat
npm run chain

# Terminal 2: Deploy et
npm run deploy:localhost
```

**Çıktı:**
```
=== Deployment Summary ===
Contract Name: ShadeFX
Contract Address: 0x...
Deployer: 0x...
Network: localhost
Chain ID: 31337
Min Stake Amount: 10000000000000000
Reward Fee Percentage: 5%

=== Deployment Info (for frontend .env) ===
REACT_APP_CONTRACT_ADDRESS=0x...
REACT_APP_NETWORK=localhost
REACT_APP_CHAIN_ID=31337
```

### 2. Sepolia Testnet'e Deploy

```bash
npm run deploy:sepolia
```

**Gereksinimler:**
- `.env` dosyasında `PRIVATE_KEY` ve `SEPOLIA_RPC_URL` ayarlı olmalı
- Sepolia testnet token'larınız olmalı

### 3. Fhenix Helium Testnet'e Deploy

```bash
npm run deploy:fhenix
```

**Gereksinimler:**
- `.env` dosyasında `PRIVATE_KEY` ve `FHENIX_RPC_URL` ayarlı olmalı
- Fhenix testnet token'larınız olmalı

## 🔧 Deploy Sonrası İşlemler

### 1. Currency Pair Oluşturma

Deploy sonrası otomatik olarak currency pair oluşturulur (opsiyonel). Manuel oluşturmak için:

```bash
# Environment variables ayarlayın
export CONTRACT_ADDRESS=0x...your_contract_address
export CURRENCY_PAIR_KEY=EURUSD
export BASE_CURRENCY=EUR
export QUOTE_CURRENCY=USD

# Script çalıştırın
npx hardhat run scripts/createPair.ts --network localhost
```

### 2. Contract Verification (Sepolia)

```bash
npm run verify:sepolia <CONTRACT_ADDRESS> "10000000000000000" "5"
```

**Gereksinimler:**
- `.env` dosyasında `ETHERSCAN_API_KEY` ayarlı olmalı

### 3. Frontend'i Güncelleyin

Deploy sonrası, frontend `.env` dosyasını güncelleyin:

```env
REACT_APP_CONTRACT_ADDRESS=0x...your_deployed_contract_address
REACT_APP_NETWORK=localhost  # veya sepolia, fhenix
REACT_APP_CHAIN_ID=31337     # veya 11155111, 8008135
```

## 📝 Deployment Scripts

### deploy/001_deploy_shadefx.ts

Ana ShadeFX kontratını deploy eder.

**Parametreler:**
- `minStakeAmount`: 0.01 ETH (10000000000000000 wei)
- `rewardFeePercentage`: 5%

### deploy/002_create_currency_pair.ts

İlk currency pair'i oluşturur (opsiyonel).

**Environment Variables:**
- `CURRENCY_PAIR_KEY`: Currency pair key (default: "EURUSD")
- `BASE_CURRENCY`: Base currency (default: "EUR")
- `QUOTE_CURRENCY`: Quote currency (default: "USD")

## ✅ Deployment Checklist

- [ ] Bağımlılıklar kuruldu (`npm install`)
- [ ] `.env` dosyası oluşturuldu ve dolduruldu
- [ ] Kontratlar compile edildi (`npm run compile`)
- [ ] Testler geçti (`npm test`)
- [ ] Network'e bağlanıldı
- [ ] Testnet token'ları alındı (testnet için)
- [ ] Deploy edildi (`npm run deploy:localhost` veya `deploy:sepolia` veya `deploy:fhenix`)
- [ ] Contract address frontend'e eklendi
- [ ] Currency pair oluşturuldu (opsiyonel)
- [ ] Contract verify edildi (opsiyonel, Sepolia için)

## 🔍 Deployment Sonrası Kontroller

### 1. Contract Address'i Kontrol Edin

```bash
# Deploy sonrası çıktıda contract address görünecek
# Veya deployments klasöründe kayıtlı olacak
```

### 2. Contract Fonksiyonlarını Test Edin

```bash
# Hardhat console kullanarak
npx hardhat console --network localhost

# Contract instance alın
const ShadeFX = await ethers.getContractFactory("ShadeFX");
const shadeFX = await ShadeFX.attach("0x...contract_address");

# Fonksiyonları test edin
await shadeFX.owner();
await shadeFX.minStakeAmount();
await shadeFX.rewardFeePercentage();
```

### 3. Frontend'i Test Edin

```bash
cd frontend
npm install
npm start
```

Frontend'de:
1. Wallet'ı bağlayın
2. Contract address'in doğru olduğunu kontrol edin
3. Currency pair'leri görüntüleyin
4. Test prediction gönderin

## ⚠️ Önemli Notlar

1. **Private Key Güvenliği**: `.env` dosyasını asla commit etmeyin
2. **Testnet Token'ları**: Deploy için yeterli token'ınız olduğundan emin olun
3. **Network Seçimi**: 
   - **Development**: Localhost
   - **Testing**: Sepolia veya Fhenix Helium
   - **Production**: Henüz yok (FHEVM mainnet bekleniyor)
4. **FHEVM Gereksinimleri**: FHEVM-compatible network kullanın
5. **Contract Verification**: Sepolia için Etherscan verification yapabilirsiniz

## 🆘 Sorun Giderme

### Compile Hatası

```bash
# Cache'i temizleyin
npm run clean

# Tekrar compile edin
npm run compile
```

### Deploy Hatası

- Private key'in doğru olduğundan emin olun
- RPC URL'in doğru olduğundan emin olun
- Network'te yeterli token olduğundan emin olun
- Chain ID'nin doğru olduğundan emin olun

### Test Hatası

- Hardhat node'un çalıştığından emin olun (localhost için)
- FHEVM plugin'in yüklü olduğundan emin olun
- Test dosyalarında `fhevm.isMock` kontrolü yapıldığından emin olun

## 📚 Kaynaklar

- [FHEVM Documentation](https://docs.zama.ai/fhevm)
- [Hardhat Deploy Documentation](https://github.com/wighawag/hardhat-deploy)
- [Fhenix Documentation](https://docs.fhenix.zone)

