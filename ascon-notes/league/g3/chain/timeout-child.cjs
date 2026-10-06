const fs=require('node:fs');
fs.writeFileSync(process.argv[2],JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
setTimeout(()=>{fs.writeFileSync(process.argv[3],'late output reached\n');console.log('{"notes":"late","executorTs":null}');},301000);
