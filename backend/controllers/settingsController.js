const db = require('../config/database');
const { logAudit } = require('../utils/auditLogger');

const allowedKeys = new Set(['lgu_name','lgu_address','lgu_contact','dispute_deadline_days','system_title','payment_deadline_days','send_violation_notice','send_payment_confirmation']);
const normalizeValue = (key, value) => {
    if (['send_violation_notice','send_payment_confirmation'].includes(key)) {
        if ([true, 1, '1', 'true', 'on'].includes(value)) return '1';
        if ([false, 0, '0', 'false', 'off'].includes(value)) return '0';
        throw new Error(`${key} must be enabled or disabled`);
    }
    if (['dispute_deadline_days','payment_deadline_days'].includes(key)) {
        const n=Number(value); if (!Number.isInteger(n) || n<1 || n>365) throw new Error(`${key} must be an integer from 1 to 365`); return String(n);
    }
    const text=String(value ?? '').trim(); if (!text || text.length>250) throw new Error(`${key} must contain 1–250 characters`); return text;
};

exports.getSystemSettings = async (req,res) => {
    try { const [settings]=await db.query('SELECT id,setting_key,setting_value,description,updated_at FROM system_settings ORDER BY setting_key'); return res.json({success:true,settings}); }
    catch(error){ console.error(error); return res.status(500).json({success:false,message:'Failed to retrieve system settings'}); }
};
exports.getSettingValue = async (req,res) => {
    try { const [rows]=await db.query('SELECT setting_value FROM system_settings WHERE setting_key=?',[req.params.key]); if(!rows.length)return res.status(404).json({success:false,message:'Setting not found'}); return res.json({success:true,value:rows[0].setting_value}); }
    catch(error){ return res.status(500).json({success:false,message:'Failed to retrieve setting'}); }
};
const persist = async entries => {
    for (const [key, raw] of entries) {
        if (!allowedKeys.has(key)) throw new Error(`Unsupported setting: ${key}`);
        const value=normalizeValue(key,raw);
        const sql = db.client === 'postgres'
            ? `INSERT INTO system_settings(setting_key,setting_value) VALUES(?,?)
               ON CONFLICT (setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value, updated_at=CURRENT_TIMESTAMP`
            : `INSERT INTO system_settings(setting_key,setting_value) VALUES(?,?)
               ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`;
        await db.query(sql,[key,value]);
    }
};
exports.updateSystemSettings = async (req,res) => {
    try { const settings=req.body.settings; if(!settings||typeof settings!=='object'||Array.isArray(settings))return res.status(400).json({success:false,message:'Invalid settings format'}); await persist(Object.entries(settings)); await logAudit({userId:req.user.id,action:'SYSTEM_SETTINGS_UPDATE',entityType:'system_settings',metadata:{keys:Object.keys(settings)},req}); return res.json({success:true,message:'System settings updated successfully'}); }
    catch(error){ return res.status(400).json({success:false,message:error.message||'Failed to update system settings'}); }
};
exports.updateBulkSettings = async (req,res) => {
    try { const updates=req.body.updates; if(!Array.isArray(updates))return res.status(400).json({success:false,message:'Updates must be an array'}); await persist(updates.filter(x=>x&&x.setting_key).map(x=>[x.setting_key,x.setting_value])); await logAudit({userId:req.user.id,action:'SYSTEM_SETTINGS_BULK_UPDATE',entityType:'system_settings',metadata:{count:updates.length},req}); return res.json({success:true,message:`${updates.length} settings updated successfully`}); }
    catch(error){ return res.status(400).json({success:false,message:error.message||'Failed to update settings'}); }
};
