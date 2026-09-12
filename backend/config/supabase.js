const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { readSupabaseConfig } = require('./supabase-settings');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const { url, key } = readSupabaseConfig();
const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, options = {}) => fetch(input, { ...options, signal: options.signal || AbortSignal.timeout(30000) }) }
});

const run = async query => {
    const { data, error } = await query;
    if (error) {
        const failure = new Error(error.message || 'Supabase request failed.');
        failure.code = ({ '23505': 'ER_DUP_ENTRY', '23503': 'ER_ROW_IS_REFERENCED_2', '42P01': 'ER_NO_SUCH_TABLE' })[error.code] || error.code;
        throw failure;
    }
    return data;
};

const rpc = (name, args = {}) => run(supabase.rpc(name, args));

// Callers supply a deterministic order and a fresh query for each page.
const allRows = async makeQuery => {
    const result = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
        const page = await run(makeQuery().range(offset, offset + pageSize - 1));
        result.push(...(page || []));
        if (!page || page.length < pageSize) return result;
    }
};

const checkConnection = async () => {
    await run(supabase.from('system_settings').select('id').limit(1));
    return true;
};

module.exports = { supabase, run, rpc, allRows, checkConnection };
