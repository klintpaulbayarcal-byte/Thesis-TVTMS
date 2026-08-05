const db=require('../config/database');
const {sendSuccess,sendError}=require('../utils/apiResponse');
const {logAudit}=require('../utils/auditLogger');
const emailService=require('../utils/emailService');

exports.createDispute=async(req,res)=>{
 try{
  const ticketId=Number(req.body.ticket_id), reason=String(req.body.reason||'').trim();
  if(!Number.isInteger(ticketId)||ticketId<=0||reason.length<10||reason.length>4000)return sendError(res,'Ticket and a reason of at least 10 characters are required',{statusCode:400,errorCode:'VALIDATION_ERROR'});
  const [rows]=await db.query(`SELECT t.id,t.ticket_number,t.status,t.user_id,t.date_issued FROM tickets t WHERE t.id=? LIMIT 1`,[ticketId]);
  if(!rows.length)return sendError(res,'Ticket not found',{statusCode:404,errorCode:'TICKET_NOT_FOUND'});
  const ticket=rows[0];
  if(req.user.role==='apprehending_officer'&&ticket.user_id!==req.user.id)return sendError(res,'You can only submit a dispute note for a ticket you issued',{statusCode:403,errorCode:'DISPUTE_ACCESS_DENIED'});
  if(ticket.status!=='unpaid')return sendError(res,'Only unpaid tickets can be disputed',{statusCode:409,errorCode:'INVALID_TICKET_STATUS'});
  const [[cfg]]=await db.query(`SELECT COALESCE((SELECT CAST(setting_value AS UNSIGNED) FROM system_settings WHERE setting_key='dispute_deadline_days'),15) deadline_days`);
  const [[age]]=await db.query('SELECT DATEDIFF(CURDATE(),?) age_days',[ticket.date_issued]);
  if(Number(age.age_days)>Number(cfg.deadline_days))return sendError(res,`The ${cfg.deadline_days}-day dispute period has ended`,{statusCode:403,errorCode:'DISPUTE_DEADLINE_EXPIRED'});
  const [existing]=await db.query(`SELECT id FROM disputes WHERE ticket_id=? AND status IN('submitted','under_review') LIMIT 1`,[ticketId]);
  if(existing.length)return sendError(res,'An active dispute already exists for this ticket',{statusCode:409,errorCode:'DISPUTE_ALREADY_EXISTS'});
  const [result]=await db.query(`INSERT INTO disputes(ticket_id,submitted_by,submission_source,reason,status) VALUES(?,?,'internal',?,'submitted')`,[ticketId,req.user.id,reason]);
  try {
   await logAudit({userId:req.user.id,action:'DISPUTE_CREATED',entityType:'disputes',entityId:result.insertId,metadata:{ticketId},req});
  } catch (auditError) {
   console.error('Dispute audit failed:', auditError.message);
  }
  return sendSuccess(res,'Dispute submitted successfully',{disputeId:result.insertId,ticketId,status:'submitted'},{statusCode:201});
 }catch(error){console.error(error);return sendError(res,'Server error while creating dispute',{statusCode:500,errorCode:'DISPUTE_CREATE_FAILED'});}
};

exports.getDisputes=async(req,res)=>{
 try{
  const {status,ticketId}=req.query; let q=`SELECT d.*,t.ticket_number,td.plate_number,td.owner_name,td.owner_email,COALESCE(s.name,d.contact_name,'Public User') submitted_by_name,r.name resolved_by_name FROM disputes d JOIN tickets t ON d.ticket_id=t.id JOIN ticket_details td ON td.id=t.id LEFT JOIN users s ON d.submitted_by=s.id LEFT JOIN users r ON d.resolved_by=r.id WHERE 1=1`; const p=[];
  if(status){q+=' AND d.status=?';p.push(status)} if(ticketId){q+=' AND d.ticket_id=?';p.push(ticketId)} if(req.user.role==='apprehending_officer'){q+=' AND t.user_id=?';p.push(req.user.id)} q+=' ORDER BY d.created_at DESC';
  const [items]=await db.query(q,p);return sendSuccess(res,'Disputes fetched successfully',items,{legacy:{disputes:items}});
 }catch(error){console.error(error);return sendError(res,'Server error while fetching disputes',{statusCode:500,errorCode:'DISPUTES_FETCH_FAILED'});}
};

exports.resolveDispute=async(req,res)=>{
 const connection=await db.getConnection(); let committed=false;
 try{
  const id=Number(req.params.id), status=String(req.body.status||'').trim(), notes=String(req.body.resolution_notes||'').trim();
  const allowed=['under_review','approved','rejected','closed']; if(!Number.isInteger(id)||id<=0||!allowed.includes(status))return sendError(res,'Invalid dispute status',{statusCode:400,errorCode:'INVALID_STATUS'});
  if(notes.length>4000||(['approved','rejected','closed'].includes(status)&&notes.length<5))return sendError(res,'Resolution notes of at least 5 characters are required',{statusCode:400,errorCode:'VALIDATION_ERROR'});
  await connection.beginTransaction();
  const [rows]=await connection.query(`SELECT d.*,t.ticket_number,t.status ticket_status,v.owner_email,v.owner_name FROM disputes d JOIN tickets t ON d.ticket_id=t.id JOIN vehicles v ON t.vehicle_id=v.id WHERE d.id=? FOR UPDATE`,[id]);
  if(!rows.length){await connection.rollback();return sendError(res,'Dispute not found',{statusCode:404,errorCode:'DISPUTE_NOT_FOUND'});} const d=rows[0];
  if(['approved','rejected','closed'].includes(d.status)){await connection.rollback();return sendError(res,'This dispute is already finalized',{statusCode:409,errorCode:'DISPUTE_FINALIZED'});}
  if (status === 'approved') {
   const [[paymentSummary]] = await connection.query(
    `SELECT COALESCE(SUM(amount_paid), 0) AS total_paid FROM payments WHERE ticket_id = ? AND payment_status <> 'voided'`,
    [d.ticket_id]
   );
   if (Number(paymentSummary.total_paid || 0) > 0) {
    await connection.rollback();
    return sendError(res,'A dispute cannot be approved after payment has been recorded',{statusCode:409,errorCode:'PAYMENT_EXISTS'});
   }
  }
  await connection.query(`UPDATE disputes SET status=?,resolution_notes=?,resolved_by=?,resolved_at=CASE WHEN ? IN('approved','rejected','closed') THEN NOW() ELSE NULL END WHERE id=?`,[status,notes||null,req.user.id,status,id]);
  if(status==='approved'&&d.ticket_status==='unpaid'){
    await connection.query(`UPDATE tickets SET status='cancelled' WHERE id=?`,[d.ticket_id]);
    await connection.query(`INSERT INTO ticket_status_history(ticket_id,previous_status,new_status,changed_by,reason,approver_id) VALUES(?,'unpaid','cancelled',?,?,?)`,[d.ticket_id,req.user.id,`Dispute approved: ${notes}`,req.user.id]);
  }
  await connection.commit();committed=true;
  try{await logAudit({userId:req.user.id,action:'DISPUTE_STATUS_UPDATED',entityType:'disputes',entityId:id,metadata:{status,ticketId:d.ticket_id},req})}catch(e){console.error(e.message)}
  const targetEmail=d.contact_email||d.owner_email;
  if(targetEmail&&['approved','rejected','closed'].includes(status)){
   try {
    await emailService.sendDisputeUpdate(targetEmail,d.contact_name||d.owner_name||'Vehicle Owner',{ticket_number:d.ticket_number,dispute_status:status,resolution_notes:notes});
   } catch (emailError) {
    console.error('Dispute update email failed:', emailError.message);
   }
  }
  if(d.submitted_by){try{await db.query(`INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id) VALUES(?,?,?,?,?,?)`,[d.submitted_by,'dispute','Dispute Status Updated',`Your dispute is now ${status.replace('_',' ')}.`,'dispute',id])}catch(e){console.error(e.message)}}
  return sendSuccess(res,'Dispute updated successfully',{id,status,ticketStatus:status==='approved'?'cancelled':d.ticket_status});
 }catch(error){if(!committed)try{await connection.rollback()}catch{} console.error(error);return sendError(res,'Server error while updating dispute',{statusCode:500,errorCode:'DISPUTE_UPDATE_FAILED'});}finally{connection.release()}
};
