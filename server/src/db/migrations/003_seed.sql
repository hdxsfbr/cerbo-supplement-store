-- 003_seed.sql — demo data. Stands in for the EHR's providers/patients (identity seam, DECISIONS #1)
-- and for a practice catalog. Greek-god patients and Dr. Welby follow Cerbo's own demo flavor.
-- Prices are integer cents; default_price gives ~30–60% margin over unit COGS (DECISIONS #6).

INSERT INTO providers (name, npi) VALUES
  ('Dr. Marcus Welby',   '1234567890'),
  ('Dr. Sarah Anderson', '1098765432');

-- ORDER BY ord: identity ids are assigned in insert order, and the demo relies on Zeus being #1.
INSERT INTO patients (provider_id, name, email)
SELECT p.id, v.name, v.email
FROM (VALUES
  (1, 'Dr. Marcus Welby',   'Zeus King',          'zeus@olympus.example'),
  (2, 'Dr. Marcus Welby',   'Hera Elaine Queen',  'hera@olympus.example'),
  (3, 'Dr. Marcus Welby',   'Demeter W Harvest',  'demeter@olympus.example'),
  (4, 'Dr. Sarah Anderson', 'Apollo Ray Sun',     'apollo@olympus.example'),
  (5, 'Dr. Sarah Anderson', 'Athena Wise',        'athena@olympus.example'),
  (6, 'Dr. Sarah Anderson', 'Poseidon C. Waters', 'poseidon@olympus.example')
) AS v(ord, provider_name, name, email)
JOIN providers p ON p.name = v.provider_name
ORDER BY v.ord;

--                                                     COGS    price   margin  stock
INSERT INTO supplements (name, sku, unit_cogs_cents, default_price_cents, inventory_count) VALUES
  ('Omega-3 Fish Oil 1000 mg (120 softgels)', 'OMG-1000-120', 1850,  3200,   /* 42% */ 120),
  ('Vitamin D3 5000 IU (90 caps)',            'VD3-5000-090',  400,   850,   /* 53% */ 200),
  ('Magnesium Glycinate 400 mg (120 caps)',   'MAG-GLY-120',   950,  1900,   /* 50% */ 150),
  ('Probiotic 50B CFU (30 caps)',             'PRO-50B-030',  2400,  4500,   /* 47% */  60),
  ('Curcumin Phytosome 500 mg (60 caps)',     'CUR-PHY-060',  2200,  3800,   /* 42% */  45),
  ('Methylated B-Complex (60 caps)',          'MBC-060',      1300,  2400,   /* 46% */  90),
  ('Berberine 500 mg (60 caps)',              'BER-500-060',  1600,  2650,   /* 40% */  35),
  ('Adrenal Support Complex (120 caps)',      'ADR-SUP-120',  3800,  6200,   /* 39% */  20);
