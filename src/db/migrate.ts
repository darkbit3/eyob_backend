import { query } from './client';
import dotenv from 'dotenv';
dotenv.config();

async function migrate() {
  console.log('🔧  Running BidLow database migrations on PostgreSQL...\n');

  // 1. Users table
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name           VARCHAR(120)   NOT NULL,
      email          VARCHAR(255)   NOT NULL UNIQUE,
      phone          VARCHAR(30)    NOT NULL UNIQUE,
      password_hash  VARCHAR(255)   NOT NULL,
      photo_url      TEXT,
      role           VARCHAR(30)    NOT NULL DEFAULT 'customer',
      status         VARCHAR(20)    NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
      wallet_balance NUMERIC(14,2)  NOT NULL DEFAULT 0,
      credits        INTEGER        NOT NULL DEFAULT 0,
      joined_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW()
    )
  `);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
  console.log('  ✓ users');

  // 2. User won auctions
  await query(`
    CREATE TABLE IF NOT EXISTS user_won_auctions (
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      auction_id UUID NOT NULL,
      PRIMARY KEY (user_id, auction_id)
    )
  `);
  console.log('  ✓ user_won_auctions');

  // 3. System settings
  await query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      id                       SERIAL PRIMARY KEY,
      platform_name            VARCHAR(120)  NOT NULL DEFAULT 'BidLow Transparent Auctions',
      support_email            VARCHAR(255)  NOT NULL DEFAULT 'admin@bidlow.et',
      currency                 VARCHAR(10)   NOT NULL DEFAULT 'ETB',
      min_bid_price            NUMERIC(10,2) NOT NULL DEFAULT 1,
      max_bid_price            NUMERIC(10,2) NOT NULL DEFAULT 5000,
      default_bid_step         NUMERIC(10,2) NOT NULL DEFAULT 1,
      max_bids_per_user        INTEGER       NOT NULL DEFAULT 0,
      auto_winner_verification BOOLEAN       NOT NULL DEFAULT TRUE,
      maintenance_mode         BOOLEAN       NOT NULL DEFAULT FALSE,
      updated_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `);
  await query(`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS max_bids_per_user INTEGER NOT NULL DEFAULT 0`);
  await query(`
    INSERT INTO system_settings (platform_name, support_email, currency)
    SELECT 'BidLow Transparent Auctions', 'admin@bidlow.et', 'ETB'
    WHERE NOT EXISTS (SELECT 1 FROM system_settings)
  `);
  console.log('  ✓ system_settings');

  // 4. Role permissions
  await query(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role        VARCHAR(80) PRIMARY KEY,
      permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    INSERT INTO role_permissions (role, permissions)
    VALUES ('customer_support', '{"Dashboard": true, "Auctions": true}'::jsonb)
    ON CONFLICT (role) DO NOTHING
  `);
  console.log('  ✓ role_permissions');

  // 5. Products
  await query(`
    CREATE TABLE IF NOT EXISTS products (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name         VARCHAR(255)  NOT NULL,
      category     VARCHAR(80)   NOT NULL,
      image_url    TEXT          NOT NULL,
      images       JSONB         NOT NULL DEFAULT '[]',
      retail_value NUMERIC(14,2) NOT NULL,
      description  TEXT,
      created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `);
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::jsonb`);
  console.log('  ✓ products');

  // 6. Auctions
  await query(`
    CREATE TABLE IF NOT EXISTS auctions (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id         UUID REFERENCES products(id) ON DELETE SET NULL,
      title              VARCHAR(255)  NOT NULL,
      description        TEXT,
      image_url          TEXT          NOT NULL,
      retail_value       NUMERIC(14,2) NOT NULL,
      bid_per_cost       NUMERIC(10,2) NOT NULL DEFAULT 100,
      max_bids_per_user  INTEGER       NOT NULL DEFAULT 0,
      category           VARCHAR(80)   NOT NULL,
      status             VARCHAR(20)   NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft','active','upcoming','paused','closed')),
      start_time         TIMESTAMPTZ   NOT NULL,
      end_time           TIMESTAMPTZ   NOT NULL,
      min_bid            NUMERIC(10,2) NOT NULL DEFAULT 1,
      max_bid            NUMERIC(10,2) NOT NULL DEFAULT 500,
      total_participants INTEGER       NOT NULL DEFAULT 0,
      total_bids         INTEGER       NOT NULL DEFAULT 0,
      winner_id          UUID REFERENCES users(id) ON DELETE SET NULL,
      winner_name        VARCHAR(120),
      lowest_unique_bid  NUMERIC(10,2),
      closed_at          TIMESTAMPTZ,
      created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `);
  await query(`ALTER TABLE auctions ADD COLUMN IF NOT EXISTS bid_per_cost NUMERIC(10,2) NOT NULL DEFAULT 100`);
  await query(`ALTER TABLE auctions ADD COLUMN IF NOT EXISTS max_bids_per_user INTEGER NOT NULL DEFAULT 0`);
  await query(`UPDATE auctions SET bid_per_cost = 100 WHERE bid_per_cost IS NULL`);
  console.log('  ✓ auctions');

  // 7. Bids
  await query(`
    CREATE TABLE IF NOT EXISTS bids (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      auction_id       UUID NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
      bidder_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      masked_bidder_id VARCHAR(20)   NOT NULL,
      amount           NUMERIC(10,2) NOT NULL,
      is_duplicate     BOOLEAN       NOT NULL DEFAULT FALSE,
      is_lowest_unique BOOLEAN       NOT NULL DEFAULT FALSE,
      created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_bids_auction_id ON bids(auction_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_bids_bidder_id  ON bids(bidder_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_users_phone     ON users(phone)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email)`);
  console.log('  ✓ bids');

  // 8. Transactions
  await query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_name      VARCHAR(120)  NOT NULL,
      type           VARCHAR(50)   NOT NULL,
      amount         NUMERIC(14,2) NOT NULL,
      description    TEXT,
      status         VARCHAR(20)   NOT NULL DEFAULT 'completed',
      payment_method VARCHAR(120),
      auction_id     UUID,
      created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `);
  await query(`ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check`);
  await query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS auction_id UUID`);
  console.log('  ✓ transactions');

  // 9. Auction unlocks
  await query(`
    CREATE TABLE IF NOT EXISTS auction_unlocks (
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      auction_id  UUID NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
      amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, auction_id)
    )
  `);
  console.log('  ✓ auction_unlocks');

  // 10. Payment queue
  await query(`
    CREATE TABLE IF NOT EXISTS payment_queue (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_name        VARCHAR(120) NOT NULL,
      user_email       VARCHAR(255) NOT NULL,
      amount           NUMERIC(14,2) NOT NULL,
      credits          INTEGER       NOT NULL,
      payment_method   VARCHAR(120)  NOT NULL,
      reference_number VARCHAR(60)   NOT NULL UNIQUE,
      receipt_image    TEXT          NOT NULL,
      status           VARCHAR(20)   NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','approved','rejected')),
      notes            TEXT,
      reviewed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `);
  await query(`ALTER TABLE payment_queue DROP CONSTRAINT IF EXISTS payment_queue_payment_method_check`);
  await query(`ALTER TABLE payment_queue ALTER COLUMN payment_method TYPE VARCHAR(120)`);
  console.log('  ✓ payment_queue');

  // 11. Notifications
  await query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       VARCHAR(40) NOT NULL,
      title      VARCHAR(255) NOT NULL,
      message    TEXT         NOT NULL,
      is_read    BOOLEAN      NOT NULL DEFAULT FALSE,
      metadata   JSONB,
      created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata JSONB`);
  await query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC)`);
  console.log('  ✓ notifications');

  // 12. Announcements
  await query(`
    CREATE TABLE IF NOT EXISTS announcements (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title           VARCHAR(255) NOT NULL,
      message         TEXT         NOT NULL,
      audience        VARCHAR(60)  NOT NULL
                        CHECK (audience IN ('All Users','Customers Only','Admins Only','Active Auction Bidders')),
      type            VARCHAR(40)  NOT NULL
                        CHECK (type IN ('System Alert','Promotion','Platform Update','Maintenance Notice')),
      sent_by         VARCHAR(120) NOT NULL,
      delivered_count INTEGER      NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  console.log('  ✓ announcements');

  // 13. Payment Gateways
  await query(`
    CREATE TABLE IF NOT EXISTS payment_gateways (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(80) NOT NULL UNIQUE,
      display_name VARCHAR(120) NOT NULL,
      public_key TEXT NOT NULL DEFAULT '',
      secret_key TEXT NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('  ✓ payment_gateways');

  // 14. Advertisements
  await query(`
    CREATE TABLE IF NOT EXISTS advertisements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title VARCHAR(160) NOT NULL,
      subtitle VARCHAR(255) NOT NULL DEFAULT '',
      image_url TEXT NOT NULL,
      target_url TEXT NOT NULL DEFAULT '',
      cta_label VARCHAR(60) NOT NULL DEFAULT 'Explore',
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('  ✓ advertisements');

  // 15. Audit Logs
  await query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      admin_id   UUID REFERENCES users(id) ON DELETE SET NULL,
      admin_name VARCHAR(120) NOT NULL,
      action     VARCHAR(120) NOT NULL,
      target     VARCHAR(255) NOT NULL,
      details    TEXT,
      ip_address VARCHAR(50),
      created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  console.log('  ✓ audit_logs');

  // 16. Refresh Tokens
  await query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      TEXT        NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('  ✓ refresh_tokens');

  // 17. Admin Bank Accounts
  await query(`
    CREATE TABLE IF NOT EXISTS admin_bank_accounts (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      method_name    VARCHAR(120) NOT NULL,
      account_number VARCHAR(100) NOT NULL,
      account_holder VARCHAR(150) NOT NULL,
      is_active      BOOLEAN NOT NULL DEFAULT TRUE,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('  ✓ admin_bank_accounts');

  console.log('\n✅  All migrations complete!\n');
  process.exit(0);
}

migrate().catch(err => {
  console.error('❌  Migration failed:', err.message);
  process.exit(1);
});
