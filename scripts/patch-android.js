// 안드로이드 프로젝트 설정 보정: 알림/정확한 알람 권한 추가
const fs = require('fs');
const p = 'android/app/src/main/AndroidManifest.xml';
let x = fs.readFileSync(p, 'utf8');
const perms = [
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.RECEIVE_BOOT_COMPLETED'
];
let add = '';
for (const q of perms) if (!x.includes(q)) add += `    <uses-permission android:name="${q}" />\n`;
if (add) x = x.replace('</manifest>', add + '</manifest>');
fs.writeFileSync(p, x);
console.log('manifest patched:', add.trim() || '(이미 있음)');

// 앱 아이콘 교체 (icons 폴더의 PNG를 안드로이드 res 폴더로 복사)
const path = require('path');
const res = 'android/app/src/main/res';
if (fs.existsSync('icons')) {
  let n = 0;
  for (const d of fs.readdirSync('icons')) {
    const src = path.join('icons', d), dst = path.join(res, d);
    if (!fs.statSync(src).isDirectory()) continue;
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) { fs.copyFileSync(path.join(src, f), path.join(dst, f)); n++; }
  }
  const bg = path.join(res, 'values/ic_launcher_background.xml');
  if (fs.existsSync(bg)) fs.writeFileSync(bg, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#4F4BF8</color>\n</resources>\n');
  console.log('icons copied:', n);
}
