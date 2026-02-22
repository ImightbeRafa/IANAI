-- =============================================
-- 038: Business Context Restructure
-- Separates business-level info from product-level info
-- =============================================

-- 1. BUSINESSES TABLE
CREATE TABLE IF NOT EXISTS businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  sales_channels TEXT[] NOT NULL DEFAULT '{}',
  location TEXT,
  does_shipping BOOLEAN NOT NULL DEFAULT false,
  shipping_method TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_businesses_owner ON businesses(owner_id);
CREATE INDEX idx_businesses_client ON businesses(client_id);

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own businesses"
  ON businesses FOR SELECT
  USING (owner_id = auth.uid());

CREATE POLICY "Users can insert own businesses"
  ON businesses FOR INSERT
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can update own businesses"
  ON businesses FOR UPDATE
  USING (owner_id = auth.uid());

CREATE POLICY "Users can delete own businesses"
  ON businesses FOR DELETE
  USING (owner_id = auth.uid());

-- Team members can access businesses via client_id
CREATE POLICY "Team members can view client businesses"
  ON businesses FOR SELECT
  USING (
    client_id IN (
      SELECT c.id FROM clients c
      JOIN team_members tm ON tm.team_id = c.team_id
      WHERE tm.user_id = auth.uid()
    )
  );

-- 2. BUSINESS TARGET AUDIENCES TABLE
CREATE TABLE IF NOT EXISTS business_target_audiences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sex TEXT NOT NULL DEFAULT 'both',
  age_min INT NOT NULL DEFAULT 18,
  age_max INT NOT NULL DEFAULT 65,
  geographic_scope TEXT NOT NULL DEFAULT 'country',
  geographic_scope_custom TEXT,
  has_specific_profession BOOLEAN NOT NULL DEFAULT false,
  profession_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_target_audiences_business ON business_target_audiences(business_id);

ALTER TABLE business_target_audiences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage target audiences via business ownership"
  ON business_target_audiences FOR ALL
  USING (
    business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
  );

CREATE POLICY "Team members can view target audiences"
  ON business_target_audiences FOR SELECT
  USING (
    business_id IN (
      SELECT b.id FROM businesses b
      JOIN clients c ON b.client_id = c.id
      JOIN team_members tm ON tm.team_id = c.team_id
      WHERE tm.user_id = auth.uid()
    )
  );

-- 3. SERVICE SUCCESS CASES TABLE
CREATE TABLE IF NOT EXISTS service_success_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  client_name TEXT,
  before_state TEXT NOT NULL,
  what_they_did TEXT NOT NULL,
  result TEXT NOT NULL,
  timeline TEXT NOT NULL,
  life_change TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_success_cases_product ON service_success_cases(product_id);

ALTER TABLE service_success_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage success cases via product ownership"
  ON service_success_cases FOR ALL
  USING (
    product_id IN (SELECT id FROM products WHERE owner_id = auth.uid())
  );

CREATE POLICY "Team members can view success cases"
  ON service_success_cases FOR SELECT
  USING (
    product_id IN (
      SELECT p.id FROM products p
      JOIN clients c ON p.client_id = c.id
      JOIN team_members tm ON tm.team_id = c.team_id
      WHERE tm.user_id = auth.uid()
    )
  );

-- 4. ADD business_id TO PRODUCTS
ALTER TABLE products ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_products_business ON products(business_id);

-- 5. ADD NEW PRODUCT-TYPE COLUMNS
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_category TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_category_custom TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS current_alternatives TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS alternatives_disadvantages TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_variations TEXT[];
ALTER TABLE products ADD COLUMN IF NOT EXISTS technical_specs TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS utility TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS result TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS has_guarantee BOOLEAN;
ALTER TABLE products ADD COLUMN IF NOT EXISTS guarantee_details TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_range TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_limited BOOLEAN;

-- 6. ADD INDUMENTARIA COLUMNS
ALTER TABLE products ADD COLUMN IF NOT EXISTS ind_article_type TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS ind_article_type_custom TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS ind_model_count INT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS ind_variations_description TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS ind_sizes TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS ind_main_material TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS ind_quality_description TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS ind_accepts_changes BOOLEAN;
ALTER TABLE products ADD COLUMN IF NOT EXISTS ind_change_policy TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS ind_customizable BOOLEAN;
ALTER TABLE products ADD COLUMN IF NOT EXISTS ind_customization_description TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS ind_product_images TEXT[];

-- 7. ADD SERVICE COLUMNS
ALTER TABLE products ADD COLUMN IF NOT EXISTS svc_service_type TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS svc_service_type_custom TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS svc_problem TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS svc_current_pain TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS svc_alternatives_tried TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS svc_alternatives_failures TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS svc_concrete_result TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS svc_result_timeline TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS svc_life_change TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS svc_process_steps TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS svc_service_format TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS svc_service_duration TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS svc_differentiation TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS svc_has_own_method BOOLEAN;
ALTER TABLE products ADD COLUMN IF NOT EXISTS svc_method_name TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS svc_main_objection TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS svc_has_guarantee BOOLEAN;
ALTER TABLE products ADD COLUMN IF NOT EXISTS svc_guarantee_details TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS svc_has_success_cases BOOLEAN;

-- 8. UPDATE TYPE CHECK CONSTRAINT to include 'indumentaria'
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_type_check;
ALTER TABLE products ADD CONSTRAINT products_type_check
  CHECK (type IN ('product', 'service', 'restaurant', 'real_estate', 'indumentaria'));
