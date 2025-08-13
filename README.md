# 🪂 R2 Money - Final Testnet Tool

A tool to automatically claim **R2 season 0** tokens, auto swap, stake, add LP, and support additional **Pharos** & **Monad** networks.

## 📌 Features
- ✅ Auto claim R2 season 0 tokens
- ✅ Auto swap, stake, add LP
- ✅ Support **Pharos** & **Monad** networks

---

## ⚡ Requirements
1. **Install Node.js** (latest version recommended):  
   [https://nodejs.org](https://nodejs.org)
2. **Get ETH testnet faucet** for gas:
   - [Google Cloud Web3 Faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)  
   - Or find other sources on Google
3. **Get testnet tokens**:
   - Join Discord: [R2 Money Discord](https://discord.com/invite/r2yield)  
   - In the testnet channel, run the command: in chat: [Faucet](https://discord.com/channels/1308368864505106442/1339883019556749395)  
     ```bash
     /faucet <your_wallet_address>
     ```
4. **Ref code** (edit in code): `FTJJY`

---

## 🔧 Installation
Clone the repository and install the required modules:
```bash
npm install
```

---

## 📄 Prepare configuration files
Create **proxy.txt** and **wallet.txt** (make sure the file extension is visible if your system hides it).

- **proxy.txt**: Each line contains a proxy in the format:
  ```
  http://user:pass@ip:port
  ```

- **wallet.txt**: Each line contains a wallet private key or seed phase:
  ```
  abc123...
  def456...
  test test test ...
  ```

---

## 👤 Generate User Agent
Run the command:
```bash
node taoagent.js
```

---

## 🚀 Run the tool
Run with:
```bash
npm start
```
or:
```bash
node r2v2.js
```

---

## 🔗 Related links
- Website: [https://r2.money/](https://r2.money/)
- ETH Testnet Faucet: [Google Cloud Faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)
- Testnet Token Faucet: [Discord R2 Money](https://discord.com/channels/1308368864505106442/1339883019556749395)

---

⚠ **Note**: This tool runs on testnet. Make sure you have enough ETH testnet and testnet tokens before using it.
