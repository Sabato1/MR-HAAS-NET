// MR HAAS CLOUD V10 - AUTO INIT VERSION - Render Deploy
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

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    business_name VARCHAR(150),
    email VARCHAR(150) UNIQUE NOT NULL,
    phone VARCHAR(20),
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'tenant',
    is_active BOOLEAN DEFAULT FALSE,
    is_verified BOOLEAN DEFAULT FALSE,
    tenant_id VARCHAR(50),
    avatar VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    trial_ends_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days')
);
CREATE TABLE IF NOT EXISTS verification_codes (
    id SERIAL PRIMARY KEY,
    email VARCHAR(150) NOT NULL,
    code VARCHAR(10) NOT NULL,
    type VARCHAR(20) DEFAULT 'registration',
    is_used BOOLEAN DEFAULT FALSE,
    expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '15 minutes'),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tenants (
    id VARCHAR(50) PRIMARY KEY,
    owner_id INTEGER,
    business_name VARCHAR(150) NOT NULL,
    owner_name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL,
    phone VARCHAR(20),
    domain VARCHAR(100),
    status VARCHAR(20) DEFAULT 'trial',
    plan VARCHAR(20) DEFAULT 'starter',
    plan_price INTEGER DEFAULT 1000,
    royalty_percent DECIMAL(5,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sites (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(50),
    name VARCHAR(100) NOT NULL,
    gateway_ip VARCHAR(20) DEFAULT '10.10.0.65',
    location VARCHAR(150),
    status VARCHAR(20) DEFAULT 'active',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS devices (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(50),
    site_id INTEGER,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL,
    brand VARCHAR(50),
    model VARCHAR(100) NOT NULL,
    mac_address VARCHAR(20) UNIQUE,
    ip_address VARCHAR(20),
    gateway_id INTEGER,
    wan_port VARCHAR(20),
    lan_ports TEXT,
    management_system VARCHAR(50),
    management_ip VARCHAR(20),
    ssid VARCHAR(100),
    status VARCHAR(20) DEFAULT 'offline',
    is_online BOOLEAN DEFAULT FALSE,
    mb_used DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS packages (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(50),
    name VARCHAR(100) NOT NULL,
    duration_days INTEGER DEFAULT 1,
    price_tzs INTEGER NOT NULL,
    speed_mbps INTEGER DEFAULT 10,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS vouchers (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(50),
    package_id INTEGER,
    code VARCHAR(50) UNIQUE NOT NULL,
    price_tzs INTEGER NOT NULL,
    batch_id VARCHAR(50),
    status VARCHAR(20) DEFAULT 'unused',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(50),
    phone VARCHAR(20) NOT NULL,
    voucher_code VARCHAR(50),
    status VARCHAR(20) DEFAULT 'offline',
    is_online BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sales (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(50),
    amount_tzs INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS platform_config (
    id SERIAL PRIMARY KEY,
    version VARCHAR(20) NOT NULL,
    title VARCHAR(100),
    changelog TEXT,
    is_live BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS subscription_plans (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    slug VARCHAR(50) UNIQUE NOT NULL,
    price_tzs INTEGER NOT NULL,
    online_users_limit INTEGER DEFAULT 49,
    devices_limit INTEGER DEFAULT 5,
    royalty_percent DECIMAL(5,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

let dbInitialized = false;
async function initDB() {
  if (dbInitialized) return true;
  try {
    console.log('MR HAAS V10 - Initializing database...');
    await pool.query(INIT_SQL);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
    const adminExists = await pool.query('SELECT * FROM users WHERE email = $1', ['sabato@mrhaas.net']);
    if (adminExists.rows.length === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await pool.query(
        "INSERT INTO users (name, business_name, email, phone, password_hash, role, is_active, is_verified) VALUES ('Sabato Mashenene','MR HAAS NET','sabato@mrhaas.net','0712345678',$1,'super_admin',true,true)",
        [hash]
      );
      console.log('Super admin created');
    }
    await pool.query(`
      INSERT INTO subscription_plans (name, slug, price_tzs, online_users_limit, devices_limit, royalty_percent) 
      VALUES 
      ('Starter','starter',1000,49,5,0),
      ('Diamond','diamond',15000,99,15,0),
      ('Premium','premium',20000,999999,999999,0),
      ('Royal','royal',20000,999999,999999,3.5)
      ON CONFLICT (slug) DO NOTHING
    `);
    await pool.query(`
      INSERT INTO platform_config (version, title, changelog, is_live)
      VALUES ('V10.0.4','V10 Auto-Update','Super Admin + Device Wizard',true)
      ON CONFLICT DO NOTHING
    `);
    dbInitialized = true;
    console.log('MR HAAS V10 Database OK!');
    return true;
  } catch (err) {
    console.error('Init DB error:', err.message);
    return false;
  }
}

initDB();

app.get('/', (req, res) => res.json({message:'MR HAAS NET V10 Live', version:'V10.0.4', dbInitialized}));
app.get('/api/platform-config', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM platform_config ORDER BY id DESC LIMIT 1');
    res.json(r.rows[0] || {version:'V10.0.4', is_live:true});
  } catch (e) { res.json({version:'V10.0.4', is_live:true}); }
});
app.get('/api/init-database', async (req, res) => {
  const ok = await initDB();
  res.json({success: ok, message: ok ? 'Database V10 initialized! Login sabato@mrhaas.net / admin123' : 'Failed', initialized: ok});
});
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    await initDB();
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(400).json({error:'Email haipo'});
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    const isDemo = email === 'sabato@mrhaas.net' && password === 'admin123';
    if (!valid && !isDemo) return res.status(400).json({error:'Password sio sahihi'});
    const role = email === 'sabato@mrhaas.net' ? 'super_admin' : user.role;
    const token = jwt.sign({id:user.id, email:user.email, tenant_id:user.tenant_id, role}, JWT_SECRET);
    res.json({token, user:{id:user.id, name:user.name, email:user.email, role, tenant_id:user.tenant_id}});
  } catch (err) { res.status(500).json({error:err.message}); }
});
app.post('/api/auth/register', async (req, res) => {
  const { name, business_name, email, phone, password } = req.body;
  try {
    await initDB();
    const existing = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(400).json({error:'Email tayari'});
    const hash = await bcrypt.hash(password, 10);
    const userResult = await pool.query(
      'INSERT INTO users (name, business_name, email, phone, password_hash, role, is_active, is_verified) VALUES ($1,$2,$3,$4,$5,$6,true,true) RETURNING id',
      [name, business_name, email, phone, hash, 'tenant']
    );
    const tenantId = 'tenant_' + Date.now();
    await pool.query(
      'INSERT INTO tenants (id, owner_id, business_name, owner_name, email, phone, status, plan) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [tenantId, userResult.rows[0].id, business_name, name, email, phone, 'trial', 'starter']
    );
    await pool.query('UPDATE users SET tenant_id = $1 WHERE id = $2', [tenantId, userResult.rows[0].id]);
    const token = jwt.sign({id:userResult.rows[0].id, email, tenant_id:tenantId, role:'tenant'}, JWT_SECRET);
    res.json({message:'Akaunti imeundwa', token, tenant_id:tenantId, demo_code:'123456'});
  } catch (err) { res.status(500).json({error:err.message}); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('MR HAAS V10 running on '+PORT));

