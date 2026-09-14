const readSupabaseConfig = (env = process.env) => {
    const rawUrl = String(env.SUPABASE_URL || '').trim();
    if (!rawUrl) throw new Error('SUPABASE_URL is required.');
    let url;
    try { url = new URL(rawUrl); } catch { throw new Error('SUPABASE_URL must be a valid HTTPS project URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
        throw new Error('SUPABASE_URL must be an HTTPS project origin.');
    }
    const key = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    let legacyServiceKey = false;
    try { legacyServiceKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'service_role'; } catch {}
    if (!key.startsWith('sb_secret_') && !legacyServiceKey) {
        throw new Error('Set SUPABASE_SECRET_KEY to a server secret key (or SUPABASE_SERVICE_ROLE_KEY to a legacy service-role key).');
    }
    return { url: url.origin, key };
};

module.exports = { readSupabaseConfig };
