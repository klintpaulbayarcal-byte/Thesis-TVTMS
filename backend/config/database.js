const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'violation_system',
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
    queueLimit: 0,
    charset: 'utf8mb4',
    dateStrings: true,
    decimalNumbers: true,
    timezone: process.env.DB_TIMEZONE || '+08:00'
});

const promisePool = pool.promise();

promisePool.checkConnection = async () => {
    const connection = await promisePool.getConnection();
    try {
        await connection.query('SELECT 1');
        return true;
    } finally {
        connection.release();
    }
};

module.exports = promisePool;
