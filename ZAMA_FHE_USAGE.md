# Zama FHE Kullanımı - ShadeFX Projesi

## Genel Bakış

ShadeFX projesi, **Zama FHEVM (Fully Homomorphic Encryption Virtual Machine)** kullanarak blockchain üzerinde şifreli hesaplamalar yapıyor. Bu sayede kullanıcıların hassas verileri (trade direction) şifreli olarak saklanıyor ve işleniyor.

**Not**: Proje artık tamamen **Perpetual DEX** odaklıdır. Prediction Market kullanılmamaktadır.

## FHE ile Şifrelenen Veriler

### **Perpetual DEX (ShadeFXPerpDEX.sol)**

#### Şifrelenen Veri: **Trade Direction (Long/Short)**
- **Tip**: `ebool` (encrypted boolean)
- **Değerler**: 
  - `true` = Long (Yükseliş pozisyonu)
  - `false` = Short (Düşüş pozisyonu)

#### 🔓 Gizlilik Durumu: **AÇIK - Pozisyon Açıldığı Anda Herkes Görebilir**
- `FHE.allowThis(direction)` → Contract decrypt edebilir
- `FHE.allow(direction, msg.sender)` → Gönderen kullanıcı decrypt edebilir
- `FHE.makePubliclyDecryptable(direction)` → **Pozisyon açıldığı anda çağrılıyor** → Herkes decrypt edebilir
- **Sonuç**: 
  - ✅ **Pozisyon açılmadan önce**: Gizli (front-running önlenir)
  - ⚠️ **Pozisyon açıldığı anda**: `makePubliclyDecryptable()` çağrılıyor → Herkes görebilir
  - **Neden**: Open interest tracking ve liquidation için gerekli

#### Kullanıldığı Yerler:

1. **`openPosition()` - Market Order**
   ```solidity
   function openPosition(
       string memory pairKey,
       externalEbool encryptedDirection,  // FHE ile şifrelenmiş direction
       bytes calldata inputProof,          // ZKPoK proof
       uint256 leverage,
       uint256 collateralAmount
   )
   ```
   - Kullanıcı Long/Short seçimini frontend'de şifreler
   - Şifrelenmiş direction contract'a gönderilir
   - Contract içinde `FHE.fromExternal()` ile internal `ebool`'a dönüştürülür
   - `FHE.allowThis()` ve `FHE.allow()` ile decrypt izni verilir
   - **Pozisyon açıldığı anda** `FHE.makePubliclyDecryptable()` çağrılıyor → Herkes görebilir (open interest tracking ve liquidation için)

2. **`createLimitOrder()` - Limit Order**
   ```solidity
   function createLimitOrder(
       string memory pairKey,
       externalEbool encryptedDirection,  // FHE ile şifrelenmiş direction
       bytes calldata inputProof,
       uint256 limitPrice,
       uint256 leverage,
       uint256 collateralAmount,
       uint256 expiryTime
   )
   ```
   - Limit order oluşturulduğunda direction şifrelenmiş olarak saklanır
   - **Order execute edildiğinde** (pozisyon açıldığında) `makePubliclyDecryptable()` çağrılıyor → Herkes görebilir

3. **`executeMarketOrder()` - Market Order Execution**
   - Limit order execute edildiğinde şifrelenmiş direction kullanılır
   - Pozisyon açıldığı anda `makePubliclyDecryptable()` çağrılıyor

#### Neden Şifreleniyor?
- **Front-running Önleme**: Pozisyon açılmadan önce direction gizli kalır, büyük pozisyonlar açılmadan önce diğer kullanıcılar göremez
- **Strateji Koruması**: Trading stratejileri pozisyon açılana kadar gizli kalır
- **Not**: Pozisyon açıldığı anda `makePubliclyDecryptable()` çağrıldığı için direction herkes tarafından görülebilir hale gelir (open interest tracking ve liquidation için gerekli)

## Frontend'de FHE Kullanımı

### 1. **FHEVM Hook (`useFHEVM.ts`)**

```typescript
const { encryptBool, isReady: fhevmReady } = useFHEVM(provider);
```

**Özellikler:**
- `encryptBool(value, contractAddress, userAddress)`: Boolean değeri şifreler
- `encrypt(value, contractAddress, userAddress)`: Sayısal değeri şifreler
- `decrypt(encrypted, contractAddress, signer)`: Şifrelenmiş değeri decrypt eder

**Kullanılan SDK:**
- `@zama-fhe/relayer-sdk/web` - Zama'nın web SDK'sı
- Sepolia testnet için yapılandırılmış
- Relayer üzerinden Gateway'e bağlanır

### 2. **Position Opening (`PositionOpening.tsx`)**

```typescript
// Direction'ı şifrele (true = Long, false = Short)
const directionBool = direction === 'long';
const encryptedInput = await encryptBool(directionBool, contractAddress, account);

// Contract'a gönder
const encryptedValue = ethers.hexlify(encryptedInput.handles[0]);
const inputProof = ethers.hexlify(encryptedInput.inputProof);

await contract.openPosition(
    pairKey,
    encryptedValue,  // externalEbool
    inputProof,      // bytes calldata
    leverage,
    collateralAmount
);
```


## FHE İşlem Akışı

### 1. **Encryption (Frontend)**
```
Kullanıcı Input (Long/Short) 
    ↓
FHEVM SDK ile Şifreleme
    ↓
encryptedValue (bytes32) + inputProof (bytes)
    ↓
Contract'a Gönderim
```

### 2. **Contract İçinde İşleme**
```
externalEbool (bytes32)
    ↓
FHE.fromExternal() → ebool (internal)
    ↓
FHE.allowThis() → Contract decrypt edebilir
    ↓
FHE.allow() → Kullanıcı decrypt edebilir
    ↓
FHE.makePubliclyDecryptable() → Herkes decrypt edebilir (opsiyonel)
```

### 3. **Decryption (Off-chain)**
```
ebool (encrypted)
    ↓
Coprocessor (Off-chain FHE computation)
    ↓
Decrypted Value (plaintext)
```

## FHE Kullanımının Avantajları

### ✅ **Gizlilik**
- Trade direction şifreli
- Sadece yetkili taraflar decrypt edebilir

### ✅ **Güvenlik**
- Zero-Knowledge Proof (ZKPoK) ile doğrulama
- Replay attack'ları önlenir
- Input validation garantisi

### ✅ **Decentralization**
- Coprocessor'lar merkezi olmayan şekilde çalışır
- Gateway koordinasyonu yapar
- KMS (Key Management Service) threshold MPC ile güvenli

## FHE Kullanımının Sınırlamaları

### ⚠️ **Mevcut Sınırlamalar**

1. **On-chain Decryption Yok**
   - Contract içinde direkt decrypt edilemez
   - `FHE.makePubliclyDecryptable()` ile async callback gerekir
   - Open interest tracking için callback kullanılmalı

2. **Encrypted Comparison Zorluğu**
   - `calculatePnLEncrypted()` fonksiyonunda direction bilinmediği için
   - Hem long hem short PnL hesaplanıyor
   - Encrypted comparison kullanılmalı (TODO)

3. **Performance**
   - FHE işlemleri off-chain coprocessor'larda yapılır
   - On-chain işlemler sadece handle'ları oluşturur
   - Gerçek hesaplama off-chain'de

## FHE Kullanım Özeti

| Özellik | Değer |
|---------|-------|
| **Şifrelenen Veri** | Trade Direction (Long/Short) |
| **FHE Tipi** | `ebool` |
| **Encryption Yeri** | Frontend (`PositionOpening.tsx`) |
| **Contract Fonksiyonları** | `openPosition()`, `createLimitOrder()` |
| **Decryption İzni** | `FHE.allowThis()`, `FHE.allow()` |
| **Public Decryption** | `FHE.makePubliclyDecryptable()` (open interest için) |

## Sonuç

ShadeFX projesi, Zama FHEVM kullanarak:
- ✅ Trade direction'ları şifreliyor (Perpetual DEX)
- ✅ Kullanıcı gizliliğini koruyor
- ✅ Front-running'ı önlüyor
- ✅ Trading stratejilerini koruyor

FHE sayesinde blockchain üzerinde gizli verilerle işlem yapılabiliyor, bu da projeye önemli bir gizlilik katmanı ekliyor.

