import { query } from './client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

async function seed() {
  console.log('🌱  Seeding BidLow PostgreSQL database...\n');

  const hash        = await bcrypt.hash('Password123!', 10);
  const adminHash   = await bcrypt.hash('Kale@1513',    10);

  // ── USERS ──────────────────────────────────────────────────────────────────
  // Insert the real admin first (upsert by phone so re-running is safe)
  await query(`
    INSERT INTO users (name, email, phone, password_hash, role, status, wallet_balance, credits)
    VALUES ('Admin', 'admin@bidlow.et', '+251909095880', $1, 'admin', 'active', 0, 0)
    ON CONFLICT (phone) DO UPDATE SET
      password_hash  = EXCLUDED.password_hash,
      role           = 'admin',
      status         = 'active'
  `, [adminHash]);
  console.log('  ✓ real admin user (+251909095880 / Kale@1513)');

  await query(`
    INSERT INTO users (id,name,email,phone,password_hash,photo_url,role,status,wallet_balance,credits) VALUES
    ('11111111-0001-0001-0001-000000000001','Abebe Girma','abebe.girma@bidlow.et','+251912345678',$1,'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=face','admin','active',15000,500),
    ('11111111-0002-0002-0002-000000000002','Tigist Bekele','tigist.b@gmail.com','+251923456789',$1,'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=150&h=150&fit=crop&crop=face','customer','active',1250,45),
    ('11111111-0003-0003-0003-000000000003','Dawit Haile','dawit.h@yahoo.com','+251934567890',$1,'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&h=150&fit=crop&crop=face','customer','active',800,12),
    ('11111111-0004-0004-0004-000000000004','Selamawit Tadesse','selam.t@gmail.com','+251945678901',$1,'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=150&h=150&fit=crop&crop=face','customer','suspended',300,5),
    ('11111111-0005-0005-0005-000000000005','Yohannes Mekonnen','yohannes.m@gmail.com','+251956789012',$1,'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&h=150&fit=crop&crop=face','customer','active',2100,78),
    ('11111111-0006-0006-0006-000000000006','Hiwot Alemu','hiwot.alemu@outlook.com','+251967890123',$1,'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&h=150&fit=crop&crop=face','customer','active',950,30),
    ('11111111-0007-0007-0007-000000000007','Bereket Solomon','bereket.s@gmail.com','+251978901234',$1,'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&h=150&fit=crop&crop=face','customer','active',1700,55),
    ('11111111-0008-0008-0008-000000000008','Mekdes Worku','mekdes.worku@ethio.net','+251989012345',$1,'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150&h=150&fit=crop&crop=face','customer','active',620,18),
    ('11111111-0009-0009-0009-000000000009','Ephrem Tesfaye','ephrem.t@gmail.com','+251910123456',$1,'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&h=150&fit=crop&crop=face','customer','active',3200,110),
    ('11111111-0010-0010-0010-000000000010','Almaz Kebede','almaz.k@gmail.com','+251921234567',$1,'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&h=150&fit=crop&crop=face','customer','active',480,8),
    ('11111111-0011-0011-0011-000000000011','Girma Desta','girma.desta@bidlow.et','+251932345678',$1,'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=150&h=150&fit=crop&crop=face','customer','active',1100,40),
    ('11111111-0012-0012-0012-000000000012','Rahel Getachew','rahel.g@gmail.com','+251943456789',$1,'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=150&h=150&fit=crop&crop=face','customer','active',760,22),
    ('11111111-0013-0013-0013-000000000013','Tamrat Assefa','tamrat.a@gmail.com','+251954567890',$1,'https://images.unsplash.com/photo-1463453091185-61582044d556?w=150&h=150&fit=crop&crop=face','customer','active',2400,90),
    ('11111111-0014-0014-0014-000000000014','Frehiwot Mulatu','frehiwot.m@yahoo.com','+251965678901',$1,'https://images.unsplash.com/photo-1489424731084-a5d8b219a5bb?w=150&h=150&fit=crop&crop=face','customer','active',890,27),
    ('11111111-0015-0015-0015-000000000015','Natnael Berhane','natnael.b@gmail.com','+251976789012',$1,'https://images.unsplash.com/photo-1568602471122-7832951cc4c5?w=150&h=150&fit=crop&crop=face','customer','active',1340,48)
    ON CONFLICT (email) DO NOTHING
  `, [hash]);
  console.log('  ✓ users (15 demo)');

  // ── PRODUCTS ───────────────────────────────────────────────────────────────
  await query(`
    INSERT INTO products (id,name,category,image_url,images,retail_value,description) VALUES
    ('22222222-0001-0001-0001-000000000001','Samsung Galaxy S25 Ultra 5G','Electronics','https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?w=600&h=400&fit=crop','["https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?w=900&h=600&fit=crop","https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=900&h=600&fit=crop","https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=900&h=600&fit=crop"]',45000,'256GB Phantom Black, Titanium Frame, 200MP Camera'),
    ('22222222-0002-0002-0002-000000000002','Apple MacBook Pro 14" M3','Electronics','https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&h=400&fit=crop','["https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=900&h=600&fit=crop","https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=900&h=600&fit=crop","https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?w=900&h=600&fit=crop"]',120000,'16GB RAM, 512GB SSD, Space Gray, Liquid Retina XDR'),
    ('22222222-0003-0003-0003-000000000003','Toyota Corolla 2024 Model','Vehicles','https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=600&h=400&fit=crop','["https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=900&h=600&fit=crop","https://images.unsplash.com/photo-1508614589041-895b88991e3e?w=900&h=600&fit=crop","https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=900&h=600&fit=crop"]',1200000,'Brand new White Pearl, 1.8L Engine, Sunroof, Automatic'),
    ('22222222-0004-0004-0004-000000000004','Sony PlayStation 5 Disc Edition','Gaming','https://images.unsplash.com/photo-1606813907291-d86efa9b94db?w=600&h=400&fit=crop','["https://images.unsplash.com/photo-1606813907291-d86efa9b94db?w=900&h=600&fit=crop","https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=900&h=600&fit=crop","https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=900&h=600&fit=crop"]',28000,'Includes 2 DualSense Controllers & Horizon Forbidden West'),
    ('22222222-0005-0005-0005-000000000005','iPhone 15 Pro Max 256GB','Electronics','https://images.unsplash.com/photo-1675785931670-9f51e7a2a6e0?w=600&h=400&fit=crop','["https://images.unsplash.com/photo-1675785931670-9f51e7a2a6e0?w=900&h=600&fit=crop","https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=900&h=600&fit=crop","https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=900&h=600&fit=crop"]',65000,'Natural Titanium, A17 Pro Chip, 5X Telephoto Lens'),
    ('22222222-0006-0006-0006-000000000006','LG 65" 4K OLED Smart TV','Home Appliances','https://images.unsplash.com/photo-1593784991095-a205069470b6?w=600&h=400&fit=crop','["https://images.unsplash.com/photo-1593784991095-a205069470b6?w=900&h=600&fit=crop","https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=900&h=600&fit=crop","https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=900&h=600&fit=crop"]',90000,'OLED65C3 Series, Dolby Vision & Atmos, 120Hz Refresh'),
    ('22222222-0007-0007-0007-000000000007','Dyson V15 Detect Cordless Vacuum','Home Appliances','https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&h=400&fit=crop','["https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=900&h=600&fit=crop","https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=900&h=600&fit=crop","https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=900&h=600&fit=crop"]',18000,'Laser Dust Sensor, 60 min run time, HEPA Filtration'),
    ('22222222-0008-0008-0008-000000000008','Rolex Submariner Date 41mm','Luxury','https://images.unsplash.com/photo-1523170335258-f5ed11844a49?w=600&h=400&fit=crop','["https://images.unsplash.com/photo-1523170335258-f5ed11844a49?w=900&h=600&fit=crop","https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=900&h=600&fit=crop","https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=900&h=600&fit=crop"]',550000,'Oystersteel with Black Cerachrom Bezel, Original Warranty'),
    ('22222222-0009-0009-0009-000000000009','iPad Pro 12.9" M2 1TB Wi-Fi','Electronics','https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=600&h=400&fit=crop','["https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=900&h=600&fit=crop","https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=900&h=600&fit=crop","https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?w=900&h=600&fit=crop"]',85000,'Liquid Retina XDR display, Space Gray, Apple Pencil support'),
    ('22222222-0010-0010-0010-000000000010','DJI Mavic 3 Pro Drone Combo','Electronics','https://images.unsplash.com/photo-1508614589041-895b88991e3e?w=600&h=400&fit=crop','["https://images.unsplash.com/photo-1508614589041-895b88991e3e?w=900&h=600&fit=crop","https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=900&h=600&fit=crop","https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=900&h=600&fit=crop"]',140000,'Hasselblad Triple Camera, 43 min flight time, RC Pro Remote')
    ON CONFLICT DO NOTHING
  `);
  console.log('  ✓ products (10)');

  // ── AUCTIONS ───────────────────────────────────────────────────────────────
  await query(`
    INSERT INTO auctions (id,product_id,title,description,image_url,retail_value,category,status,start_time,end_time,min_bid,max_bid,total_participants,total_bids,winner_id,winner_name,lowest_unique_bid,closed_at) VALUES
    ('33333333-0001-0001-0001-000000000001','22222222-0001-0001-0001-000000000001','Samsung Galaxy S25 Ultra','Brand new Samsung Galaxy S25 Ultra 256GB, Phantom Black.','https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?w=600&h=400&fit=crop',45000,'Electronics','active','2026-08-01T08:00:00Z','2026-08-10T20:00:00Z',1,500,142,389,NULL,NULL,NULL,NULL),
    ('33333333-0002-0002-0002-000000000002','22222222-0002-0002-0002-000000000002','MacBook Pro 14" M3','Apple MacBook Pro 14-inch M3 chip, 16GB RAM, 512GB SSD.','https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&h=400&fit=crop',120000,'Electronics','active','2026-08-03T10:00:00Z','2026-08-12T18:00:00Z',1,1000,87,203,NULL,NULL,NULL,NULL),
    ('33333333-0003-0003-0003-000000000003','22222222-0003-0003-0003-000000000003','Toyota Corolla 2024','Brand new Toyota Corolla 2024, White Pearl.','https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=600&h=400&fit=crop',1200000,'Vehicles','paused','2026-08-05T09:00:00Z','2026-08-15T21:00:00Z',100,5000,312,891,NULL,NULL,NULL,NULL),
    ('33333333-0004-0004-0004-000000000004','22222222-0004-0004-0004-000000000004','Sony PlayStation 5','PS5 Disc Edition bundle with 2 controllers and 3 games.','https://images.unsplash.com/photo-1606813907291-d86efa9b94db?w=600&h=400&fit=crop',28000,'Gaming','upcoming','2026-08-12T10:00:00Z','2026-08-20T20:00:00Z',1,300,0,0,NULL,NULL,NULL,NULL),
    ('33333333-0005-0005-0005-000000000005','22222222-0005-0005-0005-000000000005','iPhone 15 Pro Max 256GB','Apple iPhone 15 Pro Max 256GB, Natural Titanium. Unlocked.','https://images.unsplash.com/photo-1675785931670-9f51e7a2a6e0?w=600&h=400&fit=crop',65000,'Electronics','closed','2026-07-15T08:00:00Z','2026-07-25T20:00:00Z',1,600,198,512,'11111111-0002-0002-0002-000000000002','Tigist Bekele',7,'2026-07-25T20:00:00Z'),
    ('33333333-0006-0006-0006-000000000006','22222222-0006-0006-0006-000000000006','LG 65" OLED Smart TV','LG OLED65C3 4K OLED TV, Dolby Vision & Atmos.','https://images.unsplash.com/photo-1593784991095-a205069470b6?w=600&h=400&fit=crop',90000,'Home Appliances','closed','2026-07-01T08:00:00Z','2026-07-10T20:00:00Z',1,800,156,423,'11111111-0005-0005-0005-000000000005','Yohannes Mekonnen',13,'2026-07-10T20:00:00Z'),
    ('33333333-0007-0007-0007-000000000007','22222222-0007-0007-0007-000000000007','Dyson V15 Vacuum','Dyson V15 Detect cordless vacuum cleaner.','https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&h=400&fit=crop',18000,'Home Appliances','upcoming','2026-08-14T09:00:00Z','2026-08-22T21:00:00Z',1,200,0,0,NULL,NULL,NULL,NULL),
    ('33333333-0008-0008-0008-000000000008','22222222-0008-0008-0008-000000000008','Rolex Submariner Watch','Rolex Submariner Date 41mm, Oystersteel, Black dial.','https://images.unsplash.com/photo-1523170335258-f5ed11844a49?w=600&h=400&fit=crop',550000,'Luxury','active','2026-08-06T12:00:00Z','2026-08-16T12:00:00Z',50,4000,67,145,NULL,NULL,NULL,NULL),
    ('33333333-0009-0009-0009-000000000009','22222222-0009-0009-0009-000000000009','iPad Pro 12.9" M2','Apple iPad Pro 12.9 M2, 1TB Storage.','https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=600&h=400&fit=crop',85000,'Electronics','upcoming','2026-08-18T10:00:00Z','2026-08-28T20:00:00Z',5,800,0,0,NULL,NULL,NULL,NULL),
    ('33333333-0010-0010-0010-000000000010','22222222-0010-0010-0010-000000000010','DJI Mavic 3 Drone','DJI Mavic 3 Pro Drone Fly More Combo.','https://images.unsplash.com/photo-1508614589041-895b88991e3e?w=600&h=400&fit=crop',140000,'Electronics','draft','2026-09-01T08:00:00Z','2026-09-10T20:00:00Z',10,1200,0,0,NULL,NULL,NULL,NULL)
    ON CONFLICT DO NOTHING
  `);
  console.log('  ✓ auctions (10)');

  // ── BIDS ───────────────────────────────────────────────────────────────────
  await query(`
    INSERT INTO bids (id,auction_id,bidder_id,masked_bidder_id,amount,is_duplicate,is_lowest_unique) VALUES
    ('44444444-0001-0001-0001-000000000001','33333333-0005-0005-0005-000000000005','11111111-0002-0002-0002-000000000002','BDR-4821',7,false,true),
    ('44444444-0002-0002-0002-000000000002','33333333-0005-0005-0005-000000000005','11111111-0003-0003-0003-000000000003','BDR-7743',5,true,false),
    ('44444444-0003-0003-0003-000000000003','33333333-0005-0005-0005-000000000005','11111111-0004-0004-0004-000000000004','BDR-2291',5,true,false),
    ('44444444-0004-0004-0004-000000000004','33333333-0005-0005-0005-000000000005','11111111-0005-0005-0005-000000000005','BDR-9934',12,true,false),
    ('44444444-0005-0005-0005-000000000005','33333333-0005-0005-0005-000000000005','11111111-0006-0006-0006-000000000006','BDR-6612',12,true,false),
    ('44444444-0006-0006-0006-000000000006','33333333-0005-0005-0005-000000000005','11111111-0007-0007-0007-000000000007','BDR-3377',18,false,false),
    ('44444444-0007-0007-0007-000000000007','33333333-0005-0005-0005-000000000005','11111111-0008-0008-0008-000000000008','BDR-8812',25,false,false),
    ('44444444-0101-0101-0101-000000000101','33333333-0006-0006-0006-000000000006','11111111-0005-0005-0005-000000000005','BDR-9934',13,false,true),
    ('44444444-0102-0102-0102-000000000102','33333333-0006-0006-0006-000000000006','11111111-0002-0002-0002-000000000002','BDR-4821',4,true,false),
    ('44444444-0103-0103-0103-000000000103','33333333-0006-0006-0006-000000000006','11111111-0003-0003-0003-000000000003','BDR-7743',4,true,false)
    ON CONFLICT DO NOTHING
  `);
  console.log('  ✓ bids (10)');

  // ── TRANSACTIONS ───────────────────────────────────────────────────────────
  await query(`
    INSERT INTO transactions (user_id,user_name,type,amount,description,status,payment_method) VALUES
    ('11111111-0002-0002-0002-000000000002','Tigist Bekele','credit_purchase',500,'Purchased 50 credits via Telebirr','completed','Telebirr'),
    ('11111111-0002-0002-0002-000000000002','Tigist Bekele','bid_placed',-10,'Bid placed on Samsung Galaxy S25 Ultra','completed',NULL),
    ('11111111-0003-0003-0003-000000000003','Dawit Haile','credit_purchase',100,'Purchased 10 credits via CBE Birr','completed','CBE Birr'),
    ('11111111-0005-0005-0005-000000000005','Yohannes Mekonnen','winning_reward',90000,'Won LG 65" OLED TV auction','completed',NULL),
    ('11111111-0009-0009-0009-000000000009','Ephrem Tesfaye','credit_purchase',1800,'Purchased 250 credits via Chapa','completed','Chapa'),
    ('11111111-0007-0007-0007-000000000007','Bereket Solomon','manual_adjustment',200,'Admin adjustment: Complimentary promo credit','completed',NULL),
    ('11111111-0004-0004-0004-000000000004','Selamawit Tadesse','refund',300,'Refund for cancelled bid pool','completed',NULL),
    ('11111111-0013-0013-0013-000000000013','Tamrat Assefa','credit_purchase',800,'Purchased 100 credits via Bank Transfer','completed','Bank Transfer')
  `);
  console.log('  ✓ transactions (8)');

  // ── PAYMENT QUEUE ──────────────────────────────────────────────────────────
  await query(`
    INSERT INTO payment_queue (user_id,user_name,user_email,amount,credits,payment_method,reference_number,receipt_image,status,notes) VALUES
    ('11111111-0008-0008-0008-000000000008','Mekdes Worku','mekdes.worku@ethio.net',450,50,'Telebirr','TEL-892341092','https://images.unsplash.com/photo-1559526324-4b87b5e36e44?w=400&h=300&fit=crop','pending','Telebirr confirmation SMS screenshot submitted'),
    ('11111111-0012-0012-0012-000000000012','Rahel Getachew','rahel.g@gmail.com',1800,250,'CBE Birr','CBE-771203491','https://images.unsplash.com/photo-1556742049-0a67daf4095a?w=400&h=300&fit=crop','pending','Direct bank transfer receipt uploaded'),
    ('11111111-0014-0014-0014-000000000014','Frehiwot Mulatu','frehiwot.m@yahoo.com',800,100,'Bank Transfer','FT260808991','https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=400&h=300&fit=crop','pending','Commercial Bank of Ethiopia slip copy'),
    ('11111111-0010-0010-0010-000000000010','Almaz Kebede','almaz.k@gmail.com',100,10,'Telebirr','TEL-102938475','https://images.unsplash.com/photo-1559526324-4b87b5e36e44?w=400&h=300&fit=crop','approved','Approved by Abebe Girma')
    ON CONFLICT (reference_number) DO NOTHING
  `);
  console.log('  ✓ payment_queue (4)');

  // ── ANNOUNCEMENTS ──────────────────────────────────────────────────────────
  await query(`
    INSERT INTO announcements (title,message,audience,type,sent_by,delivered_count) VALUES
    ('Platform Maintenance Notice','We will be conducting brief database optimization on Sunday at 2:00 AM EAT.','All Users','Maintenance Notice','Abebe Girma',15),
    ('New Luxury Category Launched!','Check out our new Luxury watch auctions featuring Rolex and Omega timepieces.','Customers Only','Promotion','Abebe Girma',14),
    ('Automated Winner Verification v2.4 Enabled','All auction payouts now verified with multi-layered duplicate detection.','All Users','Platform Update','System Engine',15),
    ('Toyota Corolla Auction Bidding Guidelines','Ensure wallet balance covers registration verification before bidding.','Active Auction Bidders','System Alert','Abebe Girma',8)
  `);
  console.log('  ✓ announcements (4)');

  // ── AUDIT LOGS ─────────────────────────────────────────────────────────────
  await query(`
    INSERT INTO audit_logs (admin_id,admin_name,action,target,details,ip_address) VALUES
    ('11111111-0001-0001-0001-000000000001','Abebe Girma','Approved Payment','Mekdes Worku (TEL-892341092)','Amount: 450 ETB, Credits added: 50','127.0.0.1'),
    ('11111111-0001-0001-0001-000000000001','Abebe Girma','Paused Auction','Toyota Corolla 2024','Auction status changed to PAUSED.','127.0.0.1'),
    ('11111111-0001-0001-0001-000000000001','Abebe Girma','Sent Announcement','All Users','Title: "Platform Maintenance Notice" (Maintenance Notice)','127.0.0.1'),
    ('11111111-0001-0001-0001-000000000001','Abebe Girma','Created Auction','Samsung Galaxy S25 Ultra','Category: Electronics, Retail Value: 45000 ETB','127.0.0.1'),
    ('11111111-0011-0011-0011-000000000011','Girma Desta','Suspended User','Selamawit Tadesse (u004)','Status changed to SUSPENDED','127.0.0.1')
  `);
  console.log('  ✓ audit_logs (5)');

  // ── NOTIFICATIONS ──────────────────────────────────────────────────────────
  await query(`
    INSERT INTO notifications (user_id,type,title,message,is_read) VALUES
    ('11111111-0002-0002-0002-000000000002','winner_announced','You Won the Auction! 🎉','Congratulations! You won iPhone 15 Pro Max with a unique bid of 7 ETB.',false),
    ('11111111-0005-0005-0005-000000000005','winner_announced','You Won the LG TV Auction! 🏆','You won the LG 65" OLED Smart TV with a unique bid of 13 ETB.',false),
    ('11111111-0008-0008-0008-000000000008','payment_received','Deposit Under Review','Your Telebirr deposit of 450 ETB is pending admin approval.',true)
  `);
  console.log('  ✓ notifications (3)');

  console.log('\n✅  Seeding complete!');
  console.log('  Admin login: +251909095880 / Kale@1513');
  console.log('  Demo users password: Password123!\n');
  process.exit(0);
}

seed().catch(err => {
  console.error('❌  Seed failed:', err.message);
  process.exit(1);
});
