// Read-only prayer statistics derived from the existing calendar records.
// A record counts decades, not distinct prayer sessions or individual prayer texts.
export function mysteryCounts(record){
 if(Array.isArray(record?.mysteries)&&record.mysteries.length===4)return record.mysteries.map(n=>Number(n)||0);
 const counts=[0,0,0,0];
 if(Number.isInteger(record?.mystery)&&record.mystery>=0&&record.mystery<4)counts[record.mystery]=record.count||0;
 return counts;
}
export function monthKey(year,monthIndex){
 const d=new Date(year,monthIndex,1);
 return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function accumulate(entries){
 const byMystery=[0,0,0,0];let days=0,total=0;
 for(const [,record] of entries){
  const amount=record?.count||0;
  if(amount<=0)continue;
  days++;total+=amount;
  mysteryCounts(record).forEach((n,i)=>{byMystery[i]+=n;});
 }
 const largest=Math.max(...byMystery);
 const leaders=largest>0?byMystery.map((n,i)=>n===largest?i:-1).filter(i=>i!==-1):[];
 return {days,total,byMystery,leaders};
}
export function monthStatistics(records,key){
 return accumulate(Object.entries(records).filter(([date])=>date.slice(0,7)===key));
}
export function lifetimeStatistics(records){return accumulate(Object.entries(records));}
export function rollingMonths(records,year,monthIndex,length=12){
 return Array.from({length},(_,i)=>{
  const date=new Date(year,monthIndex-(length-i-1),1);
  const key=monthKey(date.getFullYear(),date.getMonth());
  return {key,year:date.getFullYear(),month:date.getMonth()+1,...monthStatistics(records,key)};
 });
}
