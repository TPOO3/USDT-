const { TronWeb } = require('tronweb');
const axios = require('axios');


const address = 'TDqSquXBgUCLYvYC4XZgrprLK589dkhSCf';//被监听的地址
const tokenContractAddress = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; //usdt的代币合约地址  改其他的可以监听其他代币的  


const apiKeys = [
    "1af20f99-dcd5-4f66-aff3-7d1c443bef16",
    "b7b449b9-edb7-4550-8698-aaba884f2b17",
    "e536f836-c1b3-49d7-ae70-a5ff8ac98bec"
];//为了防止api限速了  这个是key池

// 轮询计数器
let apiKeyIndex = 0;

// 获取当前密钥
function getCurrentApiKey() {
    const key = apiKeys[apiKeyIndex];
    apiKeyIndex = (apiKeyIndex + 1) % apiKeys.length; // 轮询更新索引
    return key;
}

// 初始化 TronWeb 使用轮询 API 密钥
function createTronWebInstance() {
    const tronWeb = new TronWeb({
        fullHost: 'https://api.trongrid.io',
        headers: {
            "TRON-PRO-API-KEY": getCurrentApiKey()
        }
    });
    tronWeb.setAddress(address); // 设置默认地址（修复 owner_address 问题）
    return tronWeb;
}


let tronWeb = createTronWebInstance();// TronWeb 实例


const feishuWebhook = '填飞书webhook地址';//飞书webhook推送

// API 客户端
const apiClient = axios.create({
    baseURL: 'https://api.trongrid.io',
    timeout: 10000 // 超时时间
});

// 存储之前的余额
let previousBalances = { trx: null, usdt: null };

// 飞书推送函数
async function sendToFeishu(message) {
    try {
        const response = await axios.post(feishuWebhook, {
            msg_type: 'text', // 添加消息类型
            content: { text: message } // 将消息内容放在 content 中
        });
        console.log('飞书推送成功:', message, '响应:', response.data);
    } catch (error) {
        console.error('飞书推送失败:', error.response?.data || error.message);
        console.error('请求数据:', { msg_type: 'text', content: { text: message } }); // 打印请求数据
    }
}

// 新的 TRX 查询方法，使用轮询密钥
async function fetchTRXBalance() {
    try {
        const currentKey = getCurrentApiKey(); // 获取当前轮询密钥
        const response = await axios.get(`https://api.trongrid.io/v1/accounts/${address}`, {
            headers: { "TRON-PRO-API-KEY": currentKey }
        });
        if (response.data && response.data.data && response.data.data.length > 0) {
            const balance = response.data.data[0].balance / 1e6; // 转换为 TRX 单位
            console.log(`地址 ${address} 的余额：${balance} TRX`);
            return balance; // 返回余额
        } else {
            console.log('未查询到余额数据，请检查地址或 API 配置。');
            return null; // 返回 null 表示未查询到余额
        }
    } catch (error) {
        console.error('查询失败：', error.message);
        return null; // 返回 null 表示查询失败
    }
}

// 获取 USDT 余额，确保 tronWeb 设置了 owner_address
async function getTokenBalance() {
    try {
        // 更新 tronWeb 实例并确保设置地址
        tronWeb = createTronWebInstance();
        const contract = await tronWeb.contract().at(tokenContractAddress);
        const balance = await contract.methods.balanceOf(address).call();
        return BigInt(balance) / BigInt(1_000_000); // 转为正常单位
    } catch (error) {
        console.error('获取 USDT 余额失败:', error);
        return null;
    }
}

// 手动计算 BigInt 的绝对值
function bigIntAbs(value) {
    return value < 0n ? -value : value;
}

// 监听余额变化
async function monitorBalances() {
    try {
        const [trxBalance, usdtBalance] = await Promise.all([fetchTRXBalance(), getTokenBalance()]);

        console.log(`当前 TRX 余额: ${trxBalance}, 当前 USDT 余额: ${usdtBalance}`); // 调试日志

        // 首次运行时推送初始余额
        if (previousBalances.trx === null || previousBalances.usdt === null) {
            previousBalances.trx = trxBalance;
            previousBalances.usdt = usdtBalance;

            await sendToFeishu(`地址：${address}\n当前 TRX 余额：${trxBalance} \n当前 USDT 余额：${usdtBalance}`);
            return;
        }

        // 检查 TRX 余额变化
        if (trxBalance !== previousBalances.trx) {
            const difference = trxBalance - previousBalances.trx;
            const changeType = difference > 0 ? '转入' : '转出';
            console.log(`TRX 余额变动: ${difference} (${changeType})`); // 调试日志
            await sendToFeishu(`地址：${address} ${changeType} ${Math.abs(difference)} 个 TRX`);
            previousBalances.trx = trxBalance;
        }

        // 检查 USDT 余额变化
        if (usdtBalance !== previousBalances.usdt) {
            const difference = usdtBalance - previousBalances.usdt;
            const changeType = difference > 0n ? '转入' : '转出';
            console.log(`USDT 余额变动: ${difference} (${changeType})`); // 调试日志
            await sendToFeishu(`地址：${address} ${changeType} ${bigIntAbs(difference)} 个 USDT`);
            previousBalances.usdt = usdtBalance;
        }
    } catch (error) {
        console.error('监听余额变化时出错:', error);
    }
}

// 主函数：每秒监听
async function main() {
    console.log('开始监听地址余额...');
    setInterval(monitorBalances, 1000); // 每秒执行一次
}

main();
