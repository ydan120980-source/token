'use strict';
// Monotone cubic Hermite interpolation: round curves stay inside adjacent values.
((root,factory)=>{if(typeof module==='object'&&module.exports)module.exports=factory();else root.costChart=factory();})(typeof window==='undefined'?globalThis:window,()=>{
  const n=value=>Number(value.toFixed(3));
  function curve(points){
    if(!points.length)return '';
    const slope=points.slice(1).map((p,i)=>(p.y-points[i].y)/(p.x-points[i].x));
    const tangent=points.map((p,i)=>i===0?slope[0]||0:i===points.length-1?slope[i-1]||0:slope[i-1]*slope[i]<=0?0:2/(1/slope[i-1]+1/slope[i]));
    let path='M'+n(points[0].x)+' '+n(points[0].y);
    for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=(b.x-a.x)/3;path+=' C'+n(a.x+dx)+' '+n(a.y+dx*tangent[i-1])+' '+n(b.x-dx)+' '+n(b.y-dx*tangent[i])+' '+n(b.x)+' '+n(b.y);}
    return path;
  }
  function niceMax(value){if(!Number.isFinite(value)||value<=0)return 1;const power=10**Math.floor(Math.log10(value)),scaled=value/power;return (scaled<=1?1:scaled<=2?2:scaled<=4?4:scaled<=5?5:10)*power;}
  function plot(values,{width=446,left=50,right=28,top=32,bottom=122,max=null}={}){
    const ceiling=max||niceMax(Math.max(0,...values.filter(Number.isFinite))),segments=[];let segment=[];
    const points=values.map((value,i)=>Number.isFinite(value)&&value>=0?{x:left+i*(width-left-right)/Math.max(1,values.length-1),y:bottom-value/ceiling*(bottom-top),value,index:i}:null);
    for(const p of [...points,null]){if(p)segment.push(p);else if(segment.length){segments.push(segment);segment=[];}}
    return {max:ceiling,points,segments:segments.map(points=>{const line=curve(points);return {line,area:line+' L'+n(points.at(-1).x)+' '+bottom+' L'+n(points[0].x)+' '+bottom+' Z'};})};
  }
  return Object.freeze({curve,plot,niceMax});
});
