require('dotenv').config();

const requestedClient = String(process.env.DB_CLIENT || '').trim().toLowerCase();
const postgresUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const usePostgres = requestedClient === 'postgres' || requestedClient === 'postgresql' || Boolean(postgresUrl);

const normalizePostgresError = error => {
    if (!error || typeof error !== 'object') return error;
    if (error.code === '23505') error.code = 'ER_DUP_ENTRY';
    if (error.code === '23503') error.code = 'ER_ROW_IS_REFERENCED_2';
    return error;
};

const replaceQuestionMarks = sql => {
    let index = 0;
    let quote = null;
    let output = '';
    for (let i = 0; i < sql.length; i += 1) {
        const char = sql[i];
        const next = sql[i + 1];
        if (quote) {
            output += char;
            if (char === quote && next === quote) {
                output += next;
                i += 1;
            } else if (char === quote && sql[i - 1] !== '\\') {
                quote = null;
            }
            continue;
        }
        if (char === "'" || char === '"') {
            quote = char;
            output += char;
        } else if (char === '?') {
            index += 1;
            output += `$${index}`;
        } else {
            output += char;
        }
    }
    return output;
};

const translatePostgresSql = original => {
    let sql = String(original);
    sql = sql.replace(/`([^`]+)`/g, '"$1"');
    sql = sql.replace(/\bCURDATE\(\)/gi, 'CURRENT_DATE');
    sql = sql.replace(/\bCURTIME\(\)/gi, 'CURRENT_TIME');
    sql = sql.replace(/\bNOW\(\)/gi, 'CURRENT_TIMESTAMP');
    sql = sql.replace(/\bCAST\(([^)]+)\s+AS\s+UNSIGNED\)/gi, 'CAST($1 AS INTEGER)');
    sql = sql.replace(/\bYEAR\(([^)]+)\)/gi, 'EXTRACT(YEAR FROM $1)');
    sql = sql.replace(/\bMONTH\(([^)]+)\)/gi, 'EXTRACT(MONTH FROM $1)');
    sql = sql.replace(/DATE_FORMAT\(([^,]+),\s*'%Y-%m'\)/gi, "TO_CHAR($1, 'YYYY-MM')");
    sql = sql.replace(/DATE_SUB\(CURRENT_DATE\s*,\s*INTERVAL\s+(\d+)\s+DAY\)/gi, "(CURRENT_DATE - INTERVAL '$1 days')");
    sql = sql.replace(/DATEDIFF\(CURRENT_DATE\s*,\s*MIN\(([^)]+)\)\)/gi, '(CURRENT_DATE - MIN($1)::date)');
    sql = sql.replace(/DATEDIFF\(CURRENT_DATE\s*,\s*([^),]+)\)/gi, '(CURRENT_DATE - ($1)::date)');
    sql = sql.replace(/GROUP_CONCAT\(DISTINCT\s+([^\s]+)\s+ORDER\s+BY\s+[^\s]+\s+SEPARATOR\s+', '\)/gi, "STRING_AGG(DISTINCT $1, ', ' ORDER BY $1)");
    sql = sql.replace(/TRIM\(SUBSTRING_INDEX\(LOWER\(([^)]+)\),\s*','\s*,\s*-1\)\)/gi, "TRIM(REGEXP_REPLACE(LOWER($1), '^.*,', ''))");
    sql = sql.replace(/\bDATABASE\(\)/gi, 'CURRENT_DATABASE()');
    sql = sql.replace(/TABLE_SCHEMA\s*=\s*CURRENT_DATABASE\(\)/gi, 'table_schema = CURRENT_SCHEMA()');
    sql = sql.replace(/\bLIKE\b/gi, 'ILIKE');
    return replaceQuestionMarks(sql);
};

const shouldReturnId = sql => /^\s*INSERT\s+INTO\s+/i.test(sql)
    && !/\bRETURNING\b/i.test(sql)
    && !/ticket_number_sequences/i.test(sql);

const createPostgresQuery = client => async (sql, params = []) => {
    let translated = translatePostgresSql(sql);
    const hasExplicitReturning = /\bRETURNING\b/i.test(translated);
    if (shouldReturnId(translated)) translated = `${translated.replace(/;\s*$/, '')} RETURNING id`;
    try {
        const result = await client.query(translated, params);
        if (hasExplicitReturning) return [result.rows, result.fields];
        if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(translated)) {
            return [{
                insertId: result.rows[0]?.id ?? null,
                affectedRows: result.rowCount,
                changedRows: result.rowCount
            }, result.fields];
        }
        return [result.rows, result.fields];
    } catch (error) {
        throw normalizePostgresError(error);
    }
};

const createPostgresPool = () => {
    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: postgresUrl,
        max: Number(process.env.DB_POOL_SIZE || 3),
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 10000,
        ssl: process.env.DB_SSL === '0' ? false : { rejectUnauthorized: false }
    });
    const query = createPostgresQuery(pool);
    return {
        client: 'postgres',
        query,
        async getConnection() {
            const client = await pool.connect();
            return {
                query: createPostgresQuery(client),
                beginTransaction: () => client.query('BEGIN'),
                commit: () => client.query('COMMIT'),
                rollback: () => client.query('ROLLBACK'),
                release: () => client.release()
            };
        },
        async checkConnection() {
            await pool.query('SELECT 1');
            return true;
        },
        end: () => pool.end()
    };
};

const createMysqlPool = () => {
    const mysql = require('mysql2');
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
    }).promise();
    pool.client = 'mysql';
    pool.checkConnection = async () => {
        const connection = await pool.getConnection();
        try {
            await connection.query('SELECT 1');
            return true;
        } finally {
            connection.release();
        }
    };
    return pool;
};

if (usePostgres && !postgresUrl) {
    throw new Error('DATABASE_URL or POSTGRES_URL is required when DB_CLIENT=postgres.');
}

module.exports = usePostgres ? createPostgresPool() : createMysqlPool();
