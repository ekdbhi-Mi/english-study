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
