const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function evidenceFixture(ownerId = 7) {
    let stored;
    const supabase = { from(table) {
        let operation='select', data;
        const query={ select(){return this;},eq(){return this;},limit(){return this;},single(){return this;},
            insert(value){operation='insert';data=value;return this;},
            then(resolve,reject){
                if(table==='tickets')return Promise.resolve({data:[{id:1,user_id:ownerId}]}).then(resolve,reject);
                if(operation==='insert'){stored=data;return Promise.resolve({data:{id:9}}).then(resolve,reject);}
                return Promise.resolve({data:[{...stored,id:9,tickets:{user_id:ownerId}}]}).then(resolve,reject);
            }};return query;
    }};
    const exports={};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../controllers/evidenceController.js'),'utf8'),{
        exports,Buffer,console,require(name){
            if(name==='../config/supabase')return {supabase,run:async q=>(await q).data};
            if(name==='../utils/auditLogger')return {logAudit:async()=>{}};
            if(name==='../utils/apiResponse')return require('../utils/apiResponse');
            return require(name);
        }
    });
    const response=()=>({status(code){this.code=code;return this;},json(body){this.body=body;return this;},setHeader(){},send(value){this.bytes=value;return this;}});
    return {controller:exports,response,stored:()=>stored};
}

test('evidence upload encodes bytea hex and authorized download restores the exact bytes',async()=>{
    const {controller,response,stored}=evidenceFixture();
    const bytes=Buffer.from([0xff,0xd8,0xff,0,128,255,65]);
    let res=response();
    await controller.uploadEvidence({params:{ticketId:1},user:{id:7,role:'apprehending_officer'},body:{},file:{buffer:bytes,size:bytes.length,mimetype:'image/jpeg',originalname:'photo.jpg'}},res);
    assert.equal(res.code,201);
    assert.equal(stored().file_data,'\\x'+bytes.toString('hex'));
    res=response();
    await controller.getEvidenceFile({params:{id:9},user:{id:7,role:'apprehending_officer'}},res);
    assert.deepEqual(res.bytes,bytes);
    res=response();
    await controller.getEvidenceFile({params:{id:9},user:{id:8,role:'apprehending_officer'}},res);
    assert.equal(res.code,403);
    assert.equal(res.bytes,undefined);
});

test('officers cannot upload evidence to another officer ticket',async()=>{
    const {controller,response,stored}=evidenceFixture(8);
    const res=response();
    await controller.uploadEvidence({params:{ticketId:1},user:{id:7,role:'apprehending_officer'},body:{}},res);
    assert.equal(res.code,403);
    assert.equal(stored(),undefined);
});
