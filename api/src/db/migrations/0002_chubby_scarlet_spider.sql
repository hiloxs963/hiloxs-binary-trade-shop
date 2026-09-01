CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name" text NOT NULL,
	"product_slug" text NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_quantity_check" CHECK ("order_items"."quantity" > 0 and "order_items"."quantity" <= 20),
	CONSTRAINT "order_items_unit_price_minor_check" CHECK ("order_items"."unit_price_minor" >= 0),
	CONSTRAINT "order_items_line_total_minor_check" CHECK ("order_items"."line_total_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'PENDING_PAYMENT' NOT NULL,
	"currency" text NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_status_check" CHECK ("orders"."status" in ('PENDING_PAYMENT', 'PAID', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'REFUNDED')),
	CONSTRAINT "orders_currency_check" CHECK ("orders"."currency" = 'KES'),
	CONSTRAINT "orders_subtotal_minor_check" CHECK ("orders"."subtotal_minor" >= 0),
	CONSTRAINT "orders_total_minor_check" CHECK ("orders"."total_minor" >= 0),
	CONSTRAINT "orders_request_fingerprint_check" CHECK (char_length("orders"."request_fingerprint") = 64)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalog_key" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_price_minor_check" CHECK ("products"."price_minor" >= 0),
	CONSTRAINT "products_currency_check" CHECK ("products"."currency" = 'KES'),
	CONSTRAINT "products_sort_order_check" CHECK ("products"."sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_order_id_product_id_uidx" ON "order_items" USING btree ("order_id","product_id");--> statement-breakpoint
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_order_number_uidx" ON "orders" USING btree ("order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_user_id_idempotency_key_uidx" ON "orders" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "orders_user_id_created_at_idx" ON "orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "products_catalog_key_uidx" ON "products" USING btree ("catalog_key");--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_uidx" ON "products" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "products_sort_order_uidx" ON "products" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "products_active_category_sort_idx" ON "products" USING btree ("is_active","category","sort_order");--> statement-breakpoint
INSERT INTO "products" ("id", "catalog_key", "slug", "name", "category", "description", "price_minor", "currency", "is_active", "sort_order") VALUES
('00000000-0000-4000-8000-000000000001', 'lp-01', 'hp-elitebook-840-g8-i7-16gb-512gb', 'HP EliteBook 840 G8 · i7 16GB/512GB', 'Laptops', 'Business ultrabook, backlit keyboard, 14" FHD.', 7850000, 'KES', true, 0),
('00000000-0000-4000-8000-000000000002', 'lp-02', 'dell-latitude-5420-i5-8gb-256gb', 'Dell Latitude 5420 · i5 8GB/256GB', 'Laptops', 'Reliable daily driver for school and office.', 5200000, 'KES', true, 1),
('00000000-0000-4000-8000-000000000003', 'lp-03', 'lenovo-thinkpad-x1-carbon-gen-9', 'Lenovo ThinkPad X1 Carbon Gen 9', 'Laptops', 'Carbon-fibre flagship, 1.1kg, 16GB RAM.', 11800000, 'KES', true, 2),
('00000000-0000-4000-8000-000000000004', 'lp-04', 'macbook-air-m2-8gb-256gb', 'MacBook Air M2 · 8GB/256GB', 'Laptops', 'All-day battery, silent fanless design.', 15200000, 'KES', true, 3),
('00000000-0000-4000-8000-000000000005', 'sc-01', 'samsung-55-crystal-uhd-4k-smart-tv', 'Samsung 55" Crystal UHD 4K Smart TV', 'Screens', 'HDR10+, Tizen apps, voice remote.', 6290000, 'KES', true, 4),
('00000000-0000-4000-8000-000000000006', 'sc-02', 'lg-ultragear-27-165hz-gaming-monitor', 'LG UltraGear 27" 165Hz Gaming Monitor', 'Screens', '1ms IPS, G-Sync compatible, height adjust.', 4150000, 'KES', true, 5),
('00000000-0000-4000-8000-000000000007', 'sc-03', 'dell-p2422h-24-ips-office-monitor', 'Dell P2422H 24" IPS Office Monitor', 'Screens', 'Flicker-free, pivot stand, HDMI + DP.', 2390000, 'KES', true, 6),
('00000000-0000-4000-8000-000000000008', 'sc-04', 'hisense-43-smart-frameless-tv', 'Hisense 43" Smart Frameless TV', 'Screens', 'Netflix & YouTube built in, bezel-less.', 3480000, 'KES', true, 7),
('00000000-0000-4000-8000-000000000009', 'wf-01', 'jbl-bar-5-1-soundbar-wireless-woofer', 'JBL Bar 5.1 Soundbar + Wireless Woofer', 'Woofers', '550W, detachable surround speakers.', 8900000, 'KES', true, 8),
('00000000-0000-4000-8000-000000000010', 'wf-02', 'sony-sa-sw3-200w-active-subwoofer', 'Sony SA-SW3 200W Active Subwoofer', 'Woofers', 'Deep bass module for home theatre.', 4650000, 'KES', true, 9),
('00000000-0000-4000-8000-000000000011', 'wf-03', 'vitron-3-1ch-home-theatre-woofer', 'Vitron 3.1CH Home Theatre Woofer', 'Woofers', 'Bluetooth, USB, FM — the estate favourite.', 1890000, 'KES', true, 10),
('00000000-0000-4000-8000-000000000012', 'wf-04', 'edifier-r1280db-studio-monitors', 'Edifier R1280DB Studio Monitors', 'Woofers', 'Bookshelf pair with optical + Bluetooth.', 2140000, 'KES', true, 11),
('00000000-0000-4000-8000-000000000013', 'ac-01', 'anker-65w-gan-charger-usb-c-cable', 'Anker 65W GaN Charger + USB-C Cable', 'Accessories', 'Charges laptop and phone from one brick.', 490000, 'KES', true, 12),
('00000000-0000-4000-8000-000000000014', 'ac-02', 'logitech-mx-keys-s-wireless-keyboard', 'Logitech MX Keys S Wireless Keyboard', 'Accessories', 'Backlit, multi-device, USB-C.', 1350000, 'KES', true, 13),
('00000000-0000-4000-8000-000000000015', 'ac-03', '1500va-line-interactive-ups', '1500VA Line-Interactive UPS', 'Accessories', 'Keeps the shop running through blackouts.', 1680000, 'KES', true, 14),
('00000000-0000-4000-8000-000000000016', 'ac-04', 'hdmi-2-1-8k-braided-cable-3m', 'HDMI 2.1 8K Braided Cable · 3m', 'Accessories', '48Gbps for screens and consoles.', 230000, 'KES', true, 15),
('00000000-0000-4000-8000-000000000017', 'ph-01', '20000mah-fast-power-bank', '20000mAh Fast Power Bank', 'Phones & Tablets', '22.5W fast charge, triple output.', 219900, 'KES', true, 16),
('00000000-0000-4000-8000-000000000018', 'ph-02', 'smart-6-7-android-phone-128gb', 'Smart 6.7" Android Phone 128GB', 'Phones & Tablets', '5000mAh battery, 50MP camera.', 1849900, 'KES', true, 17),
('00000000-0000-4000-8000-000000000019', 'ph-03', 'airpulse-wireless-earbuds', 'AirPulse Wireless Earbuds', 'Phones & Tablets', 'ENC calls, 30h case, USB-C.', 349900, 'KES', true, 18),
('00000000-0000-4000-8000-000000000020', 'ph-04', '10-kids-learning-tablet', '10" Kids Learning Tablet', 'Phones & Tablets', 'Parental controls and a tough case.', 1299900, 'KES', true, 19),
('00000000-0000-4000-8000-000000000021', 'hk-01', '6l-digital-air-fryer', '6L Digital Air Fryer', 'Home & Kitchen', '8 presets, non-stick basket.', 749900, 'KES', true, 20),
('00000000-0000-4000-8000-000000000022', 'hk-02', 'non-stick-cookware-set-7pc', 'Non-Stick Cookware Set · 7pc', 'Home & Kitchen', 'Pots, pans and glass lids.', 489900, 'KES', true, 21),
('00000000-0000-4000-8000-000000000023', 'hk-03', 'stainless-steel-cutlery-24pc', 'Stainless Steel Cutlery 24pc', 'Home & Kitchen', 'Rust-free family set.', 189900, 'KES', true, 22),
('00000000-0000-4000-8000-000000000024', 'hk-04', '2l-electric-kettle-cordless', '2L Electric Kettle · Cordless', 'Home & Kitchen', 'Auto shut-off, fast boil.', 229900, 'KES', true, 23),
('00000000-0000-4000-8000-000000000025', 'fa-01', 'men-s-classic-polo-shirt', 'Men''s Classic Polo Shirt', 'Fashion', 'Breathable cotton pique.', 129900, 'KES', true, 24),
('00000000-0000-4000-8000-000000000026', 'fa-02', 'urban-canvas-sneakers', 'Urban Canvas Sneakers', 'Fashion', 'Everyday street sneakers.', 329900, 'KES', true, 25),
('00000000-0000-4000-8000-000000000027', 'fa-03', 'ladies-ankara-maxi-dress', 'Ladies Ankara Maxi Dress', 'Fashion', 'Vibrant print, all sizes.', 249900, 'KES', true, 26),
('00000000-0000-4000-8000-000000000028', 'fa-04', 'minimalist-steel-watch', 'Minimalist Steel Watch', 'Fashion', 'Sapphire-look glass, 3ATM.', 289900, 'KES', true, 27),
('00000000-0000-4000-8000-000000000029', 'bh-01', 'vitamin-c-brightening-serum', 'Vitamin C Brightening Serum', 'Beauty & Health', '30ml, hyaluronic blend.', 149900, 'KES', true, 28),
('00000000-0000-4000-8000-000000000030', 'bh-02', 'shea-and-argan-body-butter', 'Shea & Argan Body Butter', 'Beauty & Health', 'Deep moisture, natural.', 99900, 'KES', true, 29),
('00000000-0000-4000-8000-000000000031', 'bh-03', 'digital-bathroom-scale', 'Digital Bathroom Scale', 'Beauty & Health', 'Tempered glass, 180kg.', 179900, 'KES', true, 30),
('00000000-0000-4000-8000-000000000032', 'bh-04', 'rechargeable-hair-clipper', 'Rechargeable Hair Clipper', 'Beauty & Health', 'Cordless, 8 guards.', 245000, 'KES', true, 31),
('00000000-0000-4000-8000-000000000033', 'so-01', 'school-backpack-waterproof', 'School Backpack · Waterproof', 'School & Office', 'Padded laptop sleeve.', 165000, 'KES', true, 32),
('00000000-0000-4000-8000-000000000034', 'so-02', 'a4-exercise-books-10-pack', 'A4 Exercise Books · 10 pack', 'School & Office', '200 pages, squared or ruled.', 78000, 'KES', true, 33),
('00000000-0000-4000-8000-000000000035', 'so-03', 'scientific-calculator-fx-991', 'Scientific Calculator FX-991', 'School & Office', '417 functions, exam ready.', 145000, 'KES', true, 34),
('00000000-0000-4000-8000-000000000036', 'so-04', 'office-desk-organiser-set', 'Office Desk Organiser Set', 'School & Office', 'Trays, pen pots and file rack.', 125000, 'KES', true, 35),
('00000000-0000-4000-8000-000000000037', 'gr-01', 'premium-aa-arabica-coffee-1kg', 'Premium AA Arabica Coffee 1kg', 'Groceries', 'Roasted beans, Kenyan grown.', 189900, 'KES', true, 36),
('00000000-0000-4000-8000-000000000038', 'gr-02', 'sunflower-cooking-oil-5l', 'Sunflower Cooking Oil 5L', 'Groceries', 'Cholesterol free, family size.', 145000, 'KES', true, 37),
('00000000-0000-4000-8000-000000000039', 'gr-03', 'long-grain-pishori-rice-5kg', 'Long Grain Pishori Rice 5kg', 'Groceries', 'Aromatic Mwea rice.', 129000, 'KES', true, 38),
('00000000-0000-4000-8000-000000000040', 'gr-04', 'assorted-spice-rack-12-jars', 'Assorted Spice Rack 12 jars', 'Groceries', 'Everyday kitchen spices.', 115000, 'KES', true, 39),
('00000000-0000-4000-8000-000000000041', 'sp-01', 'adjustable-dumbbell-set-20kg', 'Adjustable Dumbbell Set 20kg', 'Sports & Outdoors', 'Home gym starter kit.', 690000, 'KES', true, 40),
('00000000-0000-4000-8000-000000000042', 'sp-02', 'size-5-match-football', 'Size 5 Match Football', 'Sports & Outdoors', 'Hand-stitched, all surfaces.', 135000, 'KES', true, 41),
('00000000-0000-4000-8000-000000000043', 'sp-03', '6mm-yoga-mat-strap', '6mm Yoga Mat + Strap', 'Sports & Outdoors', 'Non-slip, easy to roll.', 169000, 'KES', true, 42),
('00000000-0000-4000-8000-000000000044', 'sp-04', '4-person-camping-tent', '4-Person Camping Tent', 'Sports & Outdoors', 'Waterproof, quick pitch.', 780000, 'KES', true, 43);
