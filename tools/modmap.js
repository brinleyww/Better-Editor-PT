// Prints webpack module id -> line range of a formatted bundle.
const fs=require('fs');const f=process.argv[2];const L=fs.readFileSync(f,'utf8').split('\n');
const out=[];L.forEach((l,i)=>{const m=l.match(/^\s{2,6}(\d+): (?:\(|function)/);if(m)out.push([m[1],i+1]);});
for(let i=0;i<out.length;i++)console.log(out[i][0],out[i][1],(out[i+1]?out[i+1][1]:L.length)-out[i][1]);
