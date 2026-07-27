const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'opsone_db',
  user: process.env.DB_USER || 'opsone',
  password: process.env.DB_PASS,
});
(async () => {
  const { rows } = await pool.query(
    `SELECT id, name, logo_url FROM projects WHERE logo_url LIKE 'data:%'`);
  console.log(`Found ${rows.length} project(s) with inline base64 logos`);
  for (const r of rows) {
    const m = /^data:image\/([a-zA-Z0-9+]+);base64,(.*)$/s.exec(r.logo_url);
    if (!m) { console.log(`  skip ${r.name} (unrecognised data URI)`); continue; }
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const buf = Buffer.from(m[2], 'base64');
    const fname = `logo_${r.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now()}.${ext}`;
    const dest = path.join(__dirname, '..', '..', '..', '..');
    const outDir = '/home/opsone/OpsOne/public/uploads';
    fs.writeFileSync(path.join(outDir, fname), buf);
    const url = `/uploads/${fname}`;
    await pool.query(`UPDATE projects SET logo_url=$1 WHERE id=$2`, [url, r.id]);
    console.log(`  ✅ ${r.name}: ${(r.logo_url.length/1024/1024).toFixed(2)} MB base64 → ${url} (${(buf.length/1024).toFixed(0)} KB file)`);
  }
  await pool.end();
})();
