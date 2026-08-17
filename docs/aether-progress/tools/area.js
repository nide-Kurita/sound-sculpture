// 本体を「暗部 / 中間帯 / 淡部」に分けて面積比を出す。背景色は引数で渡す。
const { decode } = require('./png');
const f = process.argv[2];
const bg = process.argv[3].split(',').map(Number);
const [x0f,y0f,x1f,y1f] = (process.argv[4] || '0.15,0.18,0.85,0.90').split(',').map(Number);
const img = decode(f);
const { width: w, height: h, bpp, data } = img;
const x0=Math.floor(w*x0f), x1=Math.floor(w*x1f), y0=Math.floor(h*y0f), y1=Math.floor(h*y1f);
let dark=0, mid=0, pale=0, body=0;
for (let y=y0;y<y1;y++) for (let x=x0;x<x1;x++) {
  const i=y*w*bpp+x*bpp;
  const r=data[i],g=data[i+1],b=data[i+2];
  const dist=Math.abs(r-bg[0])+Math.abs(g-bg[1])+Math.abs(b-bg[2]);
  if (dist < 24) continue;            // 背景
  body++;
  const lum=(0.299*r+0.587*g+0.114*b)/255;
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
  const sat=mx===0?0:(mx-mn)/mx;
  if (lum < 0.20) dark++;
  else if (sat > 0.30) mid++;
  else pale++;
}
const p=(n)=>`${(100*n/body).toFixed(1)}%`;
console.log(`${f}: body=${body}px  暗部=${p(dark)}  彩度のある中間帯=${p(mid)}  淡部=${p(pale)}`);
