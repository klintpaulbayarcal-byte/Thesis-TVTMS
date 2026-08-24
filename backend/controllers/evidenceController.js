const fs=require('fs/promises');
const path=require('path');
const crypto=require('crypto');
const multer=require('multer');
const db=require('../config/database');
const {sendSuccess,sendError}=require('../utils/apiResponse');
const {logAudit}=require('../utils/auditLogger');
const uploadDir=path.join(__dirname,'..','uploads','evidence');
const mimeExt={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','application/pdf':'.pdf'};
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1},fileFilter:(req,file,cb)=>mimeExt[file.mimetype]?cb(null,true):cb(new Error('Invalid file type. Allowed: JPG, PNG, WEBP, PDF'))});
const signatureOk=file=>{const b=file.buffer; if(file.mimetype==='image/jpeg')return b[0]===0xff&&b[1]===0xd8&&b[2]===0xff; if(file.mimetype==='image/png')return b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])); if(file.mimetype==='image/webp')return b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP'; if(file.mimetype==='application/pdf')return b.subarray(0,5).toString()==='%PDF-'; return false};
const access=async(ticketId,user)=>{const [r]=await db.query('SELECT id,user_id FROM tickets WHERE id=? LIMIT 1',[ticketId]);if(!r.length)return{ok:false,code:404};if(user.role==='apprehending_officer'&&r[0].user_id!==user.id)return{ok:false,code:403};return{ok:true}};
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
    let diskPath=null;
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
        let filePath;
        let result;
        if(db.client==='postgres'){
            filePath=`database:${filename}`;
            [result]=await db.query(
                `INSERT INTO evidence(ticket_id,file_path,file_name,file_type,file_size,uploaded_by,gps_lat,gps_lng,file_data)
                 VALUES(?,?,?,?,?,?,?,?,?)`,
                [ticketId,filePath,path.basename(req.file.originalname),req.file.mimetype,req.file.size,req.user.id,lat,lng,req.file.buffer]
            );
        }else{
            await fs.mkdir(uploadDir,{recursive:true});
            diskPath=path.join(uploadDir,filename);
            await fs.writeFile(diskPath,req.file.buffer,{flag:'wx'});
            filePath=`/uploads/evidence/${filename}`;
            [result]=await db.query(
                `INSERT INTO evidence(ticket_id,file_path,file_name,file_type,file_size,uploaded_by,gps_lat,gps_lng)
                 VALUES(?,?,?,?,?,?,?,?)`,
                [ticketId,filePath,path.basename(req.file.originalname),req.file.mimetype,req.file.size,req.user.id,lat,lng]
            );
        }
        await logAudit({userId:req.user.id,action:'EVIDENCE_UPLOADED',entityType:'evidence',entityId:result.insertId,metadata:{ticketId,fileName:path.basename(req.file.originalname)},req});
        return sendSuccess(res,'Evidence uploaded successfully',{id:result.insertId,ticketId,fileName:req.file.originalname,filePath,fileType:req.file.mimetype,fileSize:req.file.size},{statusCode:201});
    }catch(error){
        if(diskPath)try{await fs.unlink(diskPath)}catch{}
        console.error(error);
        return sendError(res,error.message?.startsWith('Invalid file type')?error.message:'Server error while uploading evidence',{statusCode:error.message?.startsWith('Invalid file type')?400:500,errorCode:'EVIDENCE_UPLOAD_FAILED'});
    }
};
exports.getTicketEvidence=async(req,res)=>{try{const ticketId=Number(req.params.ticketId),a=await access(ticketId,req.user);if(!a.ok)return sendError(res,a.code===404?'Ticket not found':'Access denied',{statusCode:a.code,errorCode:'EVIDENCE_ACCESS_DENIED'});const [items]=await db.query(`SELECT e.id,e.ticket_id,e.file_path,e.file_name,e.file_type,e.file_size,e.uploaded_by,e.gps_lat,e.gps_lng,e.created_at,e.file_type mime_type,u.name uploaded_by_name FROM evidence e LEFT JOIN users u ON e.uploaded_by=u.id WHERE e.ticket_id=? ORDER BY e.created_at DESC`,[ticketId]);return sendSuccess(res,'Ticket evidence fetched successfully',items,{legacy:{evidence:items}});}catch(error){console.error(error);return sendError(res,'Server error while fetching evidence',{statusCode:500,errorCode:'EVIDENCE_FETCH_FAILED'});}};


exports.getEvidenceFile = async (req, res) => {
    try {
        const evidenceId = Number(req.params.id);
        if (!Number.isInteger(evidenceId) || evidenceId <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid evidence ID.' });
        }

        const [rows] = await db.query(
            `SELECT e.id, e.ticket_id, e.file_path, e.file_name, e.file_type, e.file_data, t.user_id
             FROM evidence e
             JOIN tickets t ON e.ticket_id = t.id
             WHERE e.id = ? LIMIT 1`,
            [evidenceId]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'Evidence file not found.' });

        const item = rows[0];
        if (req.user.role === 'apprehending_officer' && item.user_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        if (db.client === 'postgres') {
            if (!item.file_data) return res.status(404).json({ success: false, message: 'Evidence file is missing from storage.' });
            res.setHeader('Content-Type', item.file_type || 'application/octet-stream');
            res.setHeader('Content-Disposition', `inline; filename="${String(item.file_name || 'evidence').replace(/["\\\r\n]/g, '_')}"`);
            res.setHeader('Cache-Control', 'private, no-store');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            return res.send(item.file_data);
        }

        const expectedPrefix = '/uploads/evidence/';
        if (!String(item.file_path || '').startsWith(expectedPrefix)) {
            return res.status(400).json({ success: false, message: 'Invalid evidence file path.' });
        }
        const safeName = path.basename(item.file_path);
        const diskPath = path.join(uploadDir, safeName);
        const resolved = path.resolve(diskPath);
        if (!resolved.startsWith(path.resolve(uploadDir) + path.sep)) {
            return res.status(400).json({ success: false, message: 'Invalid evidence file path.' });
        }

        await fs.access(resolved);
        res.setHeader('Content-Type', item.file_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${String(item.file_name || safeName).replace(/["\\\r\n]/g, '_')}"`);
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.sendFile(resolved);
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            return res.status(404).json({ success: false, message: 'Evidence file is missing from storage.' });
        }
        console.error('Evidence file access error:', error);
        return res.status(500).json({ success: false, message: 'Unable to load evidence file.' });
    }
};
