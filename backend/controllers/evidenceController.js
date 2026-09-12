const path=require('path');
const crypto=require('crypto');
const multer=require('multer');
const { supabase, run, allRows } = require('../config/supabase');
const {sendSuccess,sendError}=require('../utils/apiResponse');
const {logAudit}=require('../utils/auditLogger');
const mimeExt={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','application/pdf':'.pdf'};
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1},fileFilter:(req,file,cb)=>mimeExt[file.mimetype]?cb(null,true):cb(new Error('Invalid file type. Allowed: JPG, PNG, WEBP, PDF'))});
const signatureOk=file=>{const b=file.buffer; if(file.mimetype==='image/jpeg')return b[0]===0xff&&b[1]===0xd8&&b[2]===0xff; if(file.mimetype==='image/png')return b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])); if(file.mimetype==='image/webp')return b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP'; if(file.mimetype==='application/pdf')return b.subarray(0,5).toString()==='%PDF-'; return false};
const access=async(ticketId,user)=>{const r=await run(supabase.from('tickets').select('id,user_id').eq('id', ticketId).limit(1));if(!r.length)return{ok:false,code:404};if(user.role==='apprehending_officer'&&r[0].user_id!==user.id)return{ok:false,code:403};return{ok:true}};
exports.uploadMiddleware = (req, res, next) => {
    upload.single('evidence')(req, res, error => {
        if (!error) return next();
        const tooLarge = error && error.code === 'LIMIT_FILE_SIZE';
        return sendError(res,
            tooLarge ? 'Evidence file exceeds the 5 MB limit' : (error.message || 'Invalid evidence upload'),
            { statusCode: tooLarge ? 413 : 400, errorCode: tooLarge ? 'FILE_TOO_LARGE' : 'INVALID_EVIDENCE_UPLOAD' }
        );
    });
};
exports.uploadEvidence=async(req,res)=>{
    try {
        const ticketId=Number(req.params.ticketId);
        const a=await access(ticketId,req.user);
        if(!a.ok)return sendError(res,a.code===404?'Ticket not found':'Access denied',{statusCode:a.code,errorCode:'EVIDENCE_ACCESS_DENIED'});
        if(!req.file)return sendError(res,'No evidence file uploaded',{statusCode:400,errorCode:'VALIDATION_ERROR'});
        if(!signatureOk(req.file))return sendError(res,'File content does not match the declared file type',{statusCode:400,errorCode:'INVALID_FILE_SIGNATURE'});
        const parseOptionalCoordinate = value => (value === undefined || value === null || value === '') ? null : Number(value);
        const lat = parseOptionalCoordinate(req.body.gps_lat);
        const lng = parseOptionalCoordinate(req.body.gps_lng);
        if((lat!==null&&(!Number.isFinite(lat)||lat<-90||lat>90))||(lng!==null&&(!Number.isFinite(lng)||lng<-180||lng>180))){
            return sendError(res,'GPS coordinates are invalid',{statusCode:400,errorCode:'INVALID_GPS_COORDINATES'});
        }

        const filename=`${crypto.randomUUID()}${mimeExt[req.file.mimetype]}`;
        const filePath=`database:${filename}`;
        const result=await run(supabase.from('evidence').insert({ ticket_id: ticketId, file_path: filePath, file_name: path.basename(req.file.originalname), file_type: req.file.mimetype, file_size: req.file.size, uploaded_by: req.user.id, gps_lat: lat, gps_lng: lng, file_data: '\\x' + req.file.buffer.toString('hex') }).select('id').single());
        await logAudit({userId:req.user.id,action:'EVIDENCE_UPLOADED',entityType:'evidence',entityId:result.id,metadata:{ticketId,fileName:path.basename(req.file.originalname)},req});
        return sendSuccess(res,'Evidence uploaded successfully',{id:result.id,ticketId,fileName:req.file.originalname,filePath,fileType:req.file.mimetype,fileSize:req.file.size},{statusCode:201});
    }catch(error){
        console.error(error);
        return sendError(res,error.message?.startsWith('Invalid file type')?error.message:'Server error while uploading evidence',{statusCode:error.message?.startsWith('Invalid file type')?400:500,errorCode:'EVIDENCE_UPLOAD_FAILED'});
    }
};
exports.getTicketEvidence=async(req,res)=>{try{const ticketId=Number(req.params.ticketId),a=await access(ticketId,req.user);if(!a.ok)return sendError(res,a.code===404?'Ticket not found':'Access denied',{statusCode:a.code,errorCode:'EVIDENCE_ACCESS_DENIED'});const items=await allRows(() => supabase.from('evidence').select('id,ticket_id,file_path,file_name,file_type,file_size,uploaded_by,gps_lat,gps_lng,created_at,users!evidence_uploaded_by_fkey(name)').eq('ticket_id', ticketId).order('created_at', { ascending: false }).order('id'));const mapped=items.map(({users,...item})=>({...item,mime_type:item.file_type,uploaded_by_name:users?.name||null}));return sendSuccess(res,'Ticket evidence fetched successfully',mapped,{legacy:{evidence:mapped}});}catch(error){console.error(error);return sendError(res,'Server error while fetching evidence',{statusCode:500,errorCode:'EVIDENCE_FETCH_FAILED'});}};


exports.getEvidenceFile = async (req, res) => {
    try {
        const evidenceId = Number(req.params.id);
        if (!Number.isInteger(evidenceId) || evidenceId <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid evidence ID.' });
        }

        const rows = await run(supabase.from('evidence').select('id,ticket_id,file_path,file_name,file_type,file_data,tickets!inner(user_id)').eq('id', evidenceId).limit(1));
        if (!rows.length) return res.status(404).json({ success: false, message: 'Evidence file not found.' });

        const item = rows[0];
        if (req.user.role === 'apprehending_officer' && item.tickets.user_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        if (!item.file_data) return res.status(404).json({ success: false, message: 'Evidence file is missing from storage.' });
        res.setHeader('Content-Type', item.file_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${String(item.file_name || 'evidence').replace(/["\\\r\n]/g, '_')}"`);
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (typeof item.file_data !== 'string' || !/^\\x(?:[0-9a-f]{2})*$/i.test(item.file_data)) throw new Error('Invalid stored evidence encoding');
        return res.send(Buffer.from(item.file_data.slice(2), 'hex'));
    } catch (error) {
        console.error('Evidence file access error:', error);
        return res.status(500).json({ success: false, message: 'Unable to load evidence file.' });
    }
};
