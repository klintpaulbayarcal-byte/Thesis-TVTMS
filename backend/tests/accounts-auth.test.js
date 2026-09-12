const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

test('legacy email login preserves bcrypt credentials and numeric JWT account identity', async () => {
    const user = {id:42,name:'Officer',email:'officer@gov.ph',role:'apprehending_officer',status:'active',password:await bcrypt.hash('ExistingPassword1!',4)};
    const supabase={from(){let isUpdate=false;const filters=[];return {select(){return this;},eq(key,value){filters.push([key,value]);return this;},update(){isUpdate=true;return this;},then(resolve,reject){return Promise.resolve({data:isUpdate?null:filters.every(([key,value])=>user[key]===value)?[user]:[]}).then(resolve,reject);}}};
    const exports={};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../controllers/authController.js'),'utf8'),{
        exports,console,process:{env:{JWT_SECRET:'test-only-secret'}},require(name){
            if(name==='../config/supabase')return {supabase,run:async q=>(await q).data};
            if(name==='../utils/auditLogger')return {logAudit:async()=>{}};
            if(name==='../utils/emailService')return {};
            return require(name);
        }
    });
    const res={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    await exports.login({body:{email:'officer.gov.ph',password:'ExistingPassword1!'}},res);
    assert.equal(res.body.success,true);
    assert.equal(res.body.user.id,42);
    assert.equal(jwt.verify(res.body.token,'test-only-secret').id,42);
    assert.equal(res.body.user.password,undefined);
});
