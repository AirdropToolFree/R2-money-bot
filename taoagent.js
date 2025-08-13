const fs = require('fs');
const path = require('path');

function generateRandomUserAgent() {
    const browsers = [
        { name: 'Chrome', template: 'Mozilla/5.0 ({os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{version} Safari/537.36' },
        { name: 'Firefox', template: 'Mozilla/5.0 ({os}; rv:{version}) Gecko/20100101 Firefox/{version}' },
        { name: 'Safari', template: 'Mozilla/5.0 ({os}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/{version} Safari/605.1.15' },
        { name: 'Edge', template: 'Mozilla/5.0 ({os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{version} Edge/{version}' },
        { name: 'Opera', template: 'Mozilla/5.0 ({os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{version} OPR/{version}' }
    ];

    const operatingSystems = [
        'Windows NT 10.0; Win64; x64',
        'Windows NT 6.1; Win64; x64',
        'Macintosh; Intel Mac OS X 10_15_7',
        'Macintosh; Intel Mac OS X 14_0',
        'X11; Linux x86_64',
        'X11; Ubuntu; Linux x86_64'
    ];

    const versions = [
        '120.0.0.0', '119.0', '118.0', '117.0', '116.0', 
        '115.0.0.0', '90.0', '85.0', '80.0', '13.0', 
        '12.0', '15.0', '16.0'
    ];

    const browser = browsers[Math.floor(Math.random() * browsers.length)];
    const os = operatingSystems[Math.floor(Math.random() * operatingSystems.length)];
    const version = versions[Math.floor(Math.random() * versions.length)];

    return browser.template
        .replace('{os}', os)
        .replace(/{version}/g, version);
}


function generateAndSaveUserAgents(count = 1000) {
    const userAgents = new Set();

    while (userAgents.size < count) {
        const ua = generateRandomUserAgent();
        userAgents.add(ua);
    }

    const userAgentArray = Array.from(userAgents);
    const agentFile = path.join(__dirname, 'agent.txt');

    try {
        fs.writeFileSync(agentFile, userAgentArray.join('\n'));
        console.log(`Đã tạo và lưu ${userAgentArray.length} User-Agent vào ${agentFile}`);
    } catch (error) {
        console.error(`Lỗi khi lưu file agent.txt: ${error.message}`);
    }
}

// Chạy hàm với số lượng User-Agent mong muốn (mặc định 100)
generateAndSaveUserAgents(100);