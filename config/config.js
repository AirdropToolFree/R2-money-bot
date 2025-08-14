require("dotenv").config({ silent: true });
const settings = {
    MAX_THREADS: process.env.MAX_THREADS ? parseInt(process.env.MAX_THREADS) : 10,
    USE_PROXY: process.env.USE_PROXY ? process.env.USE_PROXY.toLowerCase() === "true" : false,
    MAX_THREADS_NO_PROXY: process.env.MAX_THREADS_NO_PROXY ? parseInt(process.env.MAX_THREADS_NO_PROXY) : 10,
};
module.exports = settings;