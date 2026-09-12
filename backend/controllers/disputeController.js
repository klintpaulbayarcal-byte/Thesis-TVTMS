const {supabase,run,rpc}=require('../config/supabase');
const {sendSuccess,sendError}=require('../utils/apiResponse');
const {logAudit}=require('../utils/auditLogger');
const emailService=require('../utils/emailService');

exports.createDispute=async(req,res)=>{
 try{
  const ticketId=Number(req.body.ticket_id), reason=String(req.body.reason||'').trim();
  if(!Number.isInteger(ticketId)||ticketId<=0||reason.length<10||reason.length>4000)return sendError(res,'Ticket and a reason of at least 10 characters are required',{statusCode:400,errorCode:'VALIDATION_ERROR'});
  const outcome=await rpc('tvtms_dispute_create',{p_ticket_id:ticketId,p_reason:reason,p_actor:req.user.id});
  if(outcome.errorCode)return sendError(res,outcome.message,outcome);
  const result={insertId:outcome.disputeId};
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
  const {status,ticketId}=req.query;
  const items=await rpc('tvtms_dispute_list',{p_status:status||null,p_ticket_id:ticketId ? Number(ticketId) : null,p_actor:req.user.id});
  return sendSuccess(res,'Disputes fetched successfully',items,{legacy:{disputes:items}});
 }catch(error){console.error(error);return sendError(res,'Server error while fetching disputes',{statusCode:500,errorCode:'DISPUTES_FETCH_FAILED'});}
};

exports.resolveDispute=async(req,res)=>{
 try{
  const id=Number(req.params.id), status=String(req.body.status||'').trim(), notes=String(req.body.resolution_notes||'').trim();
  const allowed=['under_review','approved','rejected','closed']; if(!Number.isInteger(id)||id<=0||!allowed.includes(status))return sendError(res,'Invalid dispute status',{statusCode:400,errorCode:'INVALID_STATUS'});
  if(notes.length>4000||(['approved','rejected','closed'].includes(status)&&notes.length<5))return sendError(res,'Resolution notes of at least 5 characters are required',{statusCode:400,errorCode:'VALIDATION_ERROR'});
  const outcome=await rpc('tvtms_dispute_resolve',{p_id:id,p_status:status,p_notes:notes||null,p_actor:req.user.id});
  if(outcome.errorCode)return sendError(res,outcome.message,outcome);
  const d=outcome.dispute;
  try{await logAudit({userId:req.user.id,action:'DISPUTE_STATUS_UPDATED',entityType:'disputes',entityId:id,metadata:{status,ticketId:d.ticket_id},req})}catch(e){console.error(e.message)}
  const targetEmail=d.contact_email||d.owner_email;
  if(targetEmail&&['approved','rejected','closed'].includes(status)){
   try {
    await emailService.sendDisputeUpdate(targetEmail,d.contact_name||d.owner_name||'Vehicle Owner',{ticket_number:d.ticket_number,dispute_status:status,resolution_notes:notes});
   } catch (emailError) {
    console.error('Dispute update email failed:', emailError.message);
   }
  }
  if(d.submitted_by){try{await run(supabase.from('notifications').insert({user_id:d.submitted_by,type:'dispute',title:'Dispute Status Updated',message:`Your dispute is now ${status.replace('_',' ')}.`,reference_type:'dispute',reference_id:id}))}catch(e){console.error(e.message)}}
  return sendSuccess(res,'Dispute updated successfully',{id,status,ticketStatus:status==='approved'?'cancelled':d.ticket_status});
 }catch(error){console.error(error);return sendError(res,'Server error while updating dispute',{statusCode:500,errorCode:'DISPUTE_UPDATE_FAILED'});}
};
