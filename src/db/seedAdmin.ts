import { query } from './client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

function normalizePhone(phone: string) {
  let p = String(phone).replace(/\s+/g, '');
  if (p.startsWith('0')) p = '+251' + p.slice(1);
  else if (p.startsWith('251')) p = '+' + p;
  return p;
}

async function seedAdmin() {
  const rawPhone = process.env.ADMIN_PHONE || '0909095880';
  const rawPass = process.env.ADMIN_PASSWORD || 'Kale@1513';
  const phone = normalizePhone(rawPhone);

  console.log(`Seeding admin user: ${phone}`);

  const adminHash = await bcrypt.hash(rawPass, Number(process.env.BCRYPT_SALT_ROUNDS) || 10);

  await query(`
    INSERT INTO users (name, email, phone, password_hash, role, status, wallet_balance, credits)
    VALUES ('Admin', 'admin@bidlow.et', $1, $2, 'admin', 'active', 0, 0)
    ON CONFLICT (phone) DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      role = 'admin',
      status = 'active'
  `, [phone, adminHash]);

  console.log(`✓ admin upserted: ${phone} / ${rawPass}`);
  process.exit(0);
}

seedAdmin().catch(err => {
  console.error('❌ seedAdmin failed:', err?.message || err);
  process.exit(1);
});
