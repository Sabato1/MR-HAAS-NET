const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const app = express();
app.use(cors());
app.use(express.json());
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const JWT_SECRET = process.env.JWT_SECRET || 'mrhaas-secret-v10';

app.post('/api/auth/register', async (req, res) => {
  const { name, business_name, email, phone, password } = req.body;
  const demoCode = '123456';
  try {
    const existing = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Email tayari inatumika' });
    const password_hash = await bcrypt.hash(password, 10);
    const userResult = await pool.query(`INSERT INTO users (name, business_name, email, phone, password_hash, role, is_active, is_verified) VALUES ($1,$2,$3,$4,$5,'tenant',false,false) RETURNING id`, [name, business_name, email, phone, password_hash]);
    await pool.query(`INSERT INTO verification_codes (email, code, type, expires_at) VALUES ($1,$2,'registration', NOW() + INTERVAL '15 minutes')`, [email, demoCode]);
    res.json({ message: 'Akaunti imeundwa', user_id: userResult.rows[0].id, demo_code: demoCode, email: email });
  } catch (err) { res.status(500).json({ error: 'Imeshindwa kusajili' }); }
});

app.post('/api/auth/verify', async (req, res) => {
  const { email, code } = req.body;
  try {
    const codeResult = await pool.query(`SELECT * FROM verification_codes WHERE email = $1 AND code = $2 AND is_used = false AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1`, [email, code]);
    if (codeResult.rows.length === 0) return res.status(400).json({ error: 'Code sio sahihi' });
    await pool.query('UPDATE verification_codes SET is_used = true WHERE id = $1', [codeResult.rows[0].id]);
    await pool.query('UPDATE users SET is_active = true, is_verified = true WHERE email = $1', [email]);
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = userResult.rows[0];
    const tenantId = `tenant_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
    await pool.query(`INSERT INTO tenants (id, owner_id, business_name, owner_name, email, phone, status, plan, trial_ends_at) VALUES ($1,$2,$3,$4,$5,$6,'trial','starter', NOW() + INTERVAL '7 days')`, [tenantId, user.id, user.business_name, user.name, user.email, user.phone]);
    await pool.query('UPDATE users SET tenant_id = $1 WHERE id = $2', [tenantId, user.id]);
    await pool.query(`INSERT INTO sites (tenant_id, name, gateway_ip, status) VALUES ($1,'SIZA UKEREWE','10.10.0.65','active'), ($1,'NANSIO','10.10.0.66','idle')`, [tenantId]);
    const token = jwt.sign({ id: user.id, email: user.email, tenant_id: tenantId, role: 'tenant' }, JWT_SECRET);
    res.json({ message: 'Akaunti ime-activate!', token, tenant_id: tenantId });
  } catch (err) { res.status(500).json({ error: 'Verification imeshindwa' }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'Email haipo' });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    const isDemoSuperAdmin = email === 'sabato@mrhaas.net' && password === 'admin123';
    if (!valid &&!isDemoSuperAdmin) return res.status(400).json({ error: 'Password sio sahihi' });
    const role = email.includes('sabato@mrhaas.net')? 'super_admin' : user.role;
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
    const token = jwt.sign({ id: user.id, email: user.email, tenant_id: user.tenant_id, role: role }, JWT_SECRET);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, tenant_id: user.tenant_id, role: role } });
  } catch (err) { res.status(500).json({ error: 'Login imeshindwa' }); }
});

app.get('/api/platform-config', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM platform_config WHERE is_live = true ORDER BY published_at DESC LIMIT 1');
    if (result.rows.length === 0) return res.json({ version: "V10.0.4", title: "V10 Auto-Update", is_live: true });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/platform-config/publish', async (req, res) => {
  const { title, changelog, version } = req.body;
  try {
    const newVersion = version || `V10.0.${Date.now()}`;
    await pool.query(`INSERT INTO platform_config (version, title, changelog, published_at, is_live, total_tenants) VALUES ($1,$2,$3,NOW(),true,(SELECT COUNT(*) FROM tenants))`, [newVersion, title, changelog]);
    await pool.query('UPDATE platform_config SET is_live = false WHERE version!= $1', [newVersion]);
    const tenants = await pool.query('SELECT id FROM tenants');
    for (const tenant of tenants.rows) {
      await pool.query(`INSERT INTO tenant_update_status (tenant_id, version, status, auto_updated) VALUES ($1,$2,'updated',true) ON CONFLICT (tenant_id, version) DO UPDATE SET status='updated'`, [tenant.id, newVersion]);
      await pool.query('UPDATE tenants SET platform_version = $1 WHERE id = $2', [newVersion, tenant.id]);
    }
    res.json({ message: `Update ${newVersion} published`, version: newVersion, tenants_updated: tenants.rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/super-admin/tenants', async (req, res) => {
  try {
    const result = await pool.query(`SELECT t.*, u.name as owner_name FROM tenants t LEFT JOIN users u ON t.owner_id = u.id ORDER BY t.created_at DESC`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/tenants/:tenantId/dashboard', async (req, res) => {
  const { tenantId } = req.params;
  try {
    const stats = await pool.query('SELECT * FROM tenant_dashboard_stats WHERE tenant_id = $1', [tenantId]);
    const sales = await pool.query('SELECT * FROM sales_summary WHERE tenant_id = $1', [tenantId]);
    res.json({ stats: stats.rows[0], sales: sales.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => { console.log(`MR HAAS CLOUD V10 running on ${PORT}`); });
